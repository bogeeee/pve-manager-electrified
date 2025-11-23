Ext.define('PVE.window.IPInfo', {
    extend: 'Ext.window.Window',
    width: 600,
    title: gettext('Network Information'),
    height: 300,
    layout: {
        type: 'fit',
    },
    modal: true,
    items: [
        {
            xtype: 'grid',
            store: {},
            emptyText: gettext('No network information'),
            viewConfig: {
                enableTextSelection: true,
            },
            columns: [
                {
                    dataIndex: 'name',
                    text: gettext('Name'),
                    renderer: Ext.htmlEncode,
                    flex: 3,
                },
                {
                    dataIndex: 'hardware-address',
                    text: gettext('MAC address'),
                    renderer: Ext.htmlEncode,
                    width: 140,
                },
                {
                    dataIndex: 'ip-addresses',
                    text: gettext('IP address'),
                    align: 'right',
                    flex: 4,
                    renderer: function (val) {
                        if (!Ext.isArray(val)) {
                            return '';
                        }
                        var ips = [];
                        val.forEach(function (ip) {
                            var addr = ip['ip-address'];
                            var pref = ip.prefix;
                            if (addr && pref) {
                                ips.push(Ext.htmlEncode(addr + '/' + pref));
                            }
                        });
                        return ips.join('<br>');
                    },
                },
            ],
        },
    ],
});

Ext.define('PVE.panel.IPViewBase', {
    extend: 'Ext.container.Container',
    xtype: 'pveIPViewBase',

    layout: {
        type: 'hbox',
        align: 'top',
    },

    nics: [],

    items: [
        {
            xtype: 'box',
            html: '<i class="fa fa-exchange"></i> IPs',
        },
        {
            xtype: 'container',
            flex: 1,
            layout: {
                type: 'vbox',
                align: 'right',
                pack: 'end',
            },
            items: [
                {
                    xtype: 'label',
                    flex: 1,
                    itemId: 'ipBox',
                    style: {
                        'text-align': 'right',
                    },
                },
                {
                    xtype: 'button',
                    itemId: 'moreBtn',
                    hidden: true,
                    ui: 'default-toolbar',
                    handler: function (btn) {
                        let view = this.up('pveIPViewBase');

                        var win = Ext.create('PVE.window.IPInfo');
                        win.down('grid').getStore().setData(view.nics);
                        win.show();
                    },
                    text: gettext('More'),
                },
            ],
        },
    ],

    getDefaultIps: function (nics) {
        var _me = this;
        var ips = [];
        nics.forEach(function (nic) {
            if (
                nic['hardware-address'] &&
                nic['hardware-address'] !== '00:00:00:00:00:00' &&
                nic['hardware-address'] !== '0:0:0:0:0:0'
            ) {
                let nic_ips = nic['ip-addresses'] || [];
                nic_ips.forEach(function (ip) {
                    var p = ip['ip-address'];
                    // show 2 ips at maximum
                    if (ips.length < 2) {
                        ips.push(Ext.htmlEncode(p));
                    }
                });
            }
        });

        return ips;
    },

    createUpdateStore: function (nodename, vmid) {
        // implement me in sub-class
    },

    startIPStore: function (store, records, success) {
        // implement me in sub-class
    },

    updateStatus: function (unsuccessful, defaultText) {
        // implement me in sub-class
    },

    initComponent: function () {
        var me = this;

        if (!me.rstore) {
            throw 'rstore not given';
        }

        if (!me.pveSelNode) {
            throw 'pveSelNode not given';
        }

        me.callParent();

        let { node, vmid } = me.pveSelNode.data;
        me.createUpdateStore(node, vmid);

        me.on('destroy', me.ipStore.stopUpdate, me.ipStore);

        // if we already have info about the vm, use it immediately
        if (me.rstore.getCount()) {
            me.startIPStore(me.rstore, me.rstore.getData(), false);
        }

        me.mon(me.rstore, 'load', me.startIPStore, me);
    },
});

Ext.define('PVE.panel.IPViewQEMU', {
    extend: 'PVE.panel.IPViewBase',
    xtype: 'pveIPViewQEMU',

    createUpdateStore: function (nodename, vmid) {
        let me = this;

        me.ipStore = Ext.create('Proxmox.data.UpdateStore', {
            interval: 10000,
            storeid: `pve-qemu-agent-${vmid}`,
            method: 'POST',
            proxy: {
                type: 'proxmox',
                url: `/api2/json/nodes/${nodename}/qemu/${vmid}/agent/network-get-interfaces`,
            },
        });

        me.mon(me.ipStore, 'load', function (_store, records, success) {
            me.nics = records?.[0]?.data.result;
            me.updateStatus(!success);
        });
    },

    updateStatus: function (unsuccessful, defaultText) {
        let me = this;

        let text = defaultText || gettext('No network information');
        let more = false;
        if (unsuccessful) {
            text = gettext('Guest Agent not running');
        } else if (me.agent && me.running) {
            if (Ext.isArray(me.nics) && me.nics.length) {
                more = true;
                let ips = me.getDefaultIps(me.nics);
                if (ips.length !== 0) {
                    text = ips.join('<br>');
                }
            } else if (me.nics && me.nics.error) {
                let msg = gettext('Cannot get info from Guest Agent<br>Error: {0}');
                text = Ext.String.format(msg, Ext.htmlEncode(me.nics.error.desc));
            }
        } else if (me.agent) {
            text = gettext('Guest Agent not running');
        } else {
            text = gettext('No Guest Agent configured');
        }

        me.down('#ipBox').update(text);
        me.down('#moreBtn').setVisible(more);
    },

    startIPStore: function (store, records, success) {
        let me = this;

        let agentRec = store.getById('agent');
        let state = store.getById('status');

        me.agent = agentRec && agentRec.data.value === 1;
        me.running = state && state.data.value === 'running';

        let caps = Ext.state.Manager.get('GuiCap');
        if (!caps.vms['VM.GuestAgent.Audit']) {
            me.updateStatus(
                false,
                Ext.String.format(gettext("Requires '{0}' Privileges"), 'VM.GuestAgent.Audit'),
            );
            return;
        }

        if (me.agent && me.running && me.ipStore.isStopped) {
            me.ipStore.startUpdate();
        } else if (me.ipStore.isStopped) {
            me.updateStatus();
        }
    },
});

Ext.define('PVE.panel.IPViewLXC', {
    extend: 'PVE.panel.IPViewBase',
    xtype: 'pveIPViewLXC',

    createUpdateStore: function (nodename, vmid) {
        let me = this;

        me.ipStore = Ext.create('Proxmox.data.UpdateStore', {
            interval: 10000,
            storeid: `lxc-interfaces-${vmid}`,
            method: 'GET',
            proxy: {
                type: 'proxmox',
                url: `/api2/json/nodes/${nodename}/lxc/${vmid}/interfaces`,
            },
        });

        me.mon(me.ipStore, 'load', function (_store, records, success) {
            me.nics = records?.map((r) => r.data);
            me.updateStatus(!success);
        });
    },

    updateStatus: function (_unsuccessful, defaultText) {
        let me = this;

        let text = defaultText || gettext('No network information');
        let more = false;
        if (Ext.isArray(me.nics) && me.nics.length) {
            more = true;
            let ips = me.getDefaultIps(me.nics);
            if (ips.length !== 0) {
                text = ips.join('<br>');
            }
        }
        me.down('#ipBox').update(text);
        me.down('#moreBtn').setVisible(more);
    },

    startIPStore: function (store, records, success) {
        let me = this;

        let state = store.getById('status');
        me.running = state && state.data.value === 'running';

        var caps = Ext.state.Manager.get('GuiCap');

        if (!caps.vms['VM.Audit']) {
            me.updateStatus(
                false,
                Ext.String.format(gettext("Requires '{0}' Privileges"), 'VM.Audit'),
            );
            return;
        }

        if (me.running && me.ipStore.isStopped) {
            me.ipStore.startUpdate();
        } else if (me.ipStore.isStopped) {
            me.updateStatus();
        }
    },
});
