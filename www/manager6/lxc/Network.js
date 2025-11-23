Ext.define('PVE.lxc.NetworkInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveLxcNetworkInputPanel',

    insideWizard: false,

    onlineHelp: 'pct_container_network',

    setNodename: function (nodename) {
        let me = this;

        if (!nodename || me.nodename === nodename) {
            return;
        }
        me.nodename = nodename;

        let bridgeSelector = me.query('[isFormField][name=bridge]')[0];
        bridgeSelector.setNodename(nodename);
    },

    onGetValues: function (values) {
        let me = this;

        let id;
        if (me.isCreate) {
            id = values.id;
            delete values.id;
        } else {
            id = me.ifname;
        }
        let newdata = {};
        if (id) {
            if (values.ipv6mode !== 'static') {
                values.ip6 = values.ipv6mode;
            }
            if (values.ipv4mode !== 'static') {
                values.ip = values.ipv4mode;
            }
            newdata[id] = PVE.Parser.printLxcNetwork(values);
        }
        return newdata;
    },

    initComponent: function () {
        let me = this;

        let cdata = {};
        if (me.insideWizard) {
            me.ifname = 'net0';
            cdata.name = 'eth0';
            me.dataCache = {};
        }
        cdata.firewall = me.insideWizard || me.isCreate;

        if (!me.dataCache) {
            throw 'no dataCache specified';
        }

        if (!me.isCreate) {
            if (!me.ifname) {
                throw 'no interface name specified';
            }
            if (!me.dataCache[me.ifname]) {
                throw "no such interface '" + me.ifname + "'";
            }
            cdata = PVE.Parser.parseLxcNetwork(me.dataCache[me.ifname]);
        }

        for (let i = 0; i < 32; i++) {
            let ifname = 'net' + i.toString();
            if (me.isCreate && !me.dataCache[ifname]) {
                me.ifname = ifname;
                break;
            }
        }

        me.column1 = [
            {
                xtype: 'hidden',
                name: 'id',
                value: me.ifname,
            },
            {
                xtype: 'textfield',
                name: 'name',
                fieldLabel: gettext('Name'),
                emptyText: '(e.g., eth0)',
                allowBlank: false,
                value: cdata.name,
                validator: function (value) {
                    for (const [key, netRaw] of Object.entries(me.dataCache)) {
                        if (!key.match(/^net\d+/) || key === me.ifname) {
                            continue;
                        }
                        let net = PVE.Parser.parseLxcNetwork(netRaw);
                        if (net.name === value) {
                            return 'interface name already in use';
                        }
                    }
                    return true;
                },
            },
            {
                xtype: 'textfield',
                name: 'hwaddr',
                fieldLabel: gettext('MAC address'),
                vtype: 'MacAddress',
                value: cdata.hwaddr,
                allowBlank: true,
                emptyText: 'auto',
            },
            {
                xtype: 'PVE.form.BridgeSelector',
                name: 'bridge',
                nodename: me.nodename,
                fieldLabel: gettext('Bridge'),
                value: cdata.bridge,
                allowBlank: false,
            },
            {
                xtype: 'pveVlanField',
                name: 'tag',
                value: cdata.tag,
            },
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Firewall'),
                name: 'firewall',
                value: cdata.firewall,
            },
        ];

        let dhcp4 = cdata.ip === 'dhcp';
        if (dhcp4) {
            cdata.ip = '';
            cdata.gw = '';
        }

        let auto6 = cdata.ip6 === 'auto';
        let dhcp6 = cdata.ip6 === 'dhcp';
        if (auto6 || dhcp6) {
            cdata.ip6 = '';
            cdata.gw6 = '';
        }

        me.column2 = [
            {
                layout: {
                    type: 'hbox',
                    align: 'middle',
                },
                border: false,
                margin: '0 0 5 0',
                items: [
                    {
                        xtype: 'label',
                        text: 'IPv4:', // do not localize
                    },
                    {
                        xtype: 'radiofield',
                        boxLabel: gettext('Static'),
                        name: 'ipv4mode',
                        inputValue: 'static',
                        checked: !dhcp4,
                        margin: '0 0 0 10',
                        listeners: {
                            change: function (cb, value) {
                                me.down('field[name=ip]').setEmptyText(
                                    value ? Proxmox.Utils.NoneText : '',
                                );
                                me.down('field[name=ip]').setDisabled(!value);
                                me.down('field[name=gw]').setDisabled(!value);
                            },
                        },
                    },
                    {
                        xtype: 'radiofield',
                        boxLabel: 'DHCP', // do not localize
                        name: 'ipv4mode',
                        inputValue: 'dhcp',
                        checked: dhcp4,
                        margin: '0 0 0 10',
                    },
                ],
            },
            {
                xtype: 'textfield',
                name: 'ip',
                vtype: 'IPCIDRAddress',
                value: cdata.ip,
                emptyText: dhcp4 ? '' : Proxmox.Utils.NoneText,
                disabled: dhcp4,
                fieldLabel: 'IPv4/CIDR', // do not localize
            },
            {
                xtype: 'textfield',
                name: 'gw',
                value: cdata.gw,
                vtype: 'IPAddress',
                disabled: dhcp4,
                fieldLabel: gettext('Gateway') + ' (IPv4)',
                margin: '0 0 3 0', // override bottom margin to account for the menuseparator
            },
            {
                xtype: 'menuseparator',
                height: '3',
                margin: '0',
            },
            {
                layout: {
                    type: 'hbox',
                    align: 'middle',
                },
                border: false,
                margin: '0 0 5 0',
                items: [
                    {
                        xtype: 'label',
                        text: 'IPv6:', // do not localize
                    },
                    {
                        xtype: 'radiofield',
                        boxLabel: gettext('Static'),
                        name: 'ipv6mode',
                        inputValue: 'static',
                        checked: !(auto6 || dhcp6),
                        margin: '0 0 0 10',
                        listeners: {
                            change: function (cb, value) {
                                me.down('field[name=ip6]').setEmptyText(
                                    value ? Proxmox.Utils.NoneText : '',
                                );
                                me.down('field[name=ip6]').setDisabled(!value);
                                me.down('field[name=gw6]').setDisabled(!value);
                            },
                        },
                    },
                    {
                        xtype: 'radiofield',
                        boxLabel: 'DHCP', // do not localize
                        name: 'ipv6mode',
                        inputValue: 'dhcp',
                        checked: dhcp6,
                        margin: '0 0 0 10',
                    },
                    {
                        xtype: 'radiofield',
                        boxLabel: 'SLAAC', // do not localize
                        name: 'ipv6mode',
                        inputValue: 'auto',
                        checked: auto6,
                        margin: '0 0 0 10',
                    },
                ],
            },
            {
                xtype: 'textfield',
                name: 'ip6',
                value: cdata.ip6,
                emptyText: dhcp6 || auto6 ? '' : Proxmox.Utils.NoneText,
                vtype: 'IP6CIDRAddress',
                disabled: dhcp6 || auto6,
                fieldLabel: 'IPv6/CIDR', // do not localize
            },
            {
                xtype: 'textfield',
                name: 'gw6',
                vtype: 'IP6Address',
                value: cdata.gw6,
                disabled: dhcp6 || auto6,
                fieldLabel: gettext('Gateway') + ' (IPv6)',
            },
        ];

        me.advancedColumn1 = [
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Disconnect'),
                name: 'link_down',
                value: cdata.link_down,
            },
            {
                xtype: 'proxmoxintegerfield',
                fieldLabel: 'MTU',
                emptyText: gettext('Same as bridge'),
                name: 'mtu',
                value: cdata.mtu,
                minValue: 576,
                maxValue: 65535,
            },
        ];

        me.advancedColumn2 = [
            {
                xtype: 'numberfield',
                name: 'rate',
                fieldLabel: gettext('Rate limit') + ' (MB/s)',
                minValue: 0,
                maxValue: 10 * 1024,
                value: cdata.rate,
                emptyText: 'unlimited',
                allowBlank: true,
            },
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Host-Managed'),
                name: 'host-managed',
                value: cdata['host-managed'],
            },
        ];

        me.callParent();
    },
});

Ext.define('PVE.lxc.NetworkEdit', {
    extend: 'Proxmox.window.Edit',

    isAdd: true,

    initComponent: function () {
        let me = this;

        if (!me.dataCache) {
            throw 'no dataCache specified';
        }
        if (!me.nodename) {
            throw 'no node name specified';
        }

        Ext.apply(me, {
            subject: gettext('Network Device') + ' (veth)',
            digest: me.dataCache.digest,
            items: [
                {
                    xtype: 'pveLxcNetworkInputPanel',
                    ifname: me.ifname,
                    nodename: me.nodename,
                    dataCache: me.dataCache,
                    isCreate: me.isCreate,
                },
            ],
        });

        me.callParent();
    },
});

Ext.define(
    'PVE.lxc.NetworkView',
    {
        extend: 'Ext.grid.GridPanel',
        alias: 'widget.pveLxcNetworkView',

        onlineHelp: 'pct_container_network',

        dataCache: {}, // used to store result of last load

        stateful: true,
        stateId: 'grid-lxc-network',

        load: async function () {
            let me = this;

            Proxmox.Utils.setErrorMask(me, true);

            let nodename = me.pveSelNode.data.node;
            let vmid = me.pveSelNode.data.vmid;

            try {
                let ifResponse = await Proxmox.Async.api2({
                    url: `/nodes/${nodename}/lxc/${vmid}/interfaces`,
                    method: 'GET',
                });
                let confResponse = await Proxmox.Async.api2({
                    url: me.url,
                });
                Proxmox.Utils.setErrorMask(me, false);

                let interfaces = [];
                for (const [, iface] of Object.entries(ifResponse?.result?.data || {})) {
                    interfaces[iface['hardware-address']] = iface;
                }

                let records = [];
                me.dataCache = confResponse.result.data || {};
                for (const [key, value] of Object.entries(confResponse.result.data)) {
                    if (!key.match(/^net\d+/)) {
                        continue;
                    }
                    let config = PVE.Parser.parseLxcNetwork(value);
                    let net = structuredClone(config);
                    net.id = key;

                    let iface = interfaces[config.hwaddr.toLowerCase()];
                    if (iface) {
                        net.name = iface.name;
                        net.ip = [];
                        net.ip6 = [];
                        for (const i of iface['ip-addresses']) {
                            let ip_with_prefix = `${i['ip-address']}/${i.prefix}`;
                            if (i['ip-address-type'] === 'inet') {
                                if (config.ip === ip_with_prefix) {
                                    net.ip.push(`${ip_with_prefix} (static)`);
                                } else {
                                    // this could be dhcp, but also a static address set directly on the container
                                    net.ip.push(`${ip_with_prefix} (dynamic)`);
                                }
                            } else if (i['ip-address-type'] === 'inet6') {
                                if (config.ip6 === ip_with_prefix) {
                                    net.ip6.push(`${ip_with_prefix} (static)`);
                                } else {
                                    // this could be dhcp, slaac, but also a static address set directly on the container
                                    net.ip6.push(`${ip_with_prefix} (dynamic)`);
                                }
                            }
                        }
                    }
                    records.push(net);
                }

                me.store.loadData(records);
                me.down('button[name=addButton]').setDisabled(records.length >= 32);
            } catch (error) {
                Proxmox.Utils.setErrorMask(me, gettext('Error') + ': ' + error);
            }
        },

        initComponent: function () {
            let me = this;

            let nodename = me.pveSelNode.data.node;
            if (!nodename) {
                throw 'no node name specified';
            }

            let vmid = me.pveSelNode.data.vmid;
            if (!vmid) {
                throw 'no VM ID specified';
            }

            let caps = Ext.state.Manager.get('GuiCap');

            me.url = `/nodes/${nodename}/lxc/${vmid}/config`;

            let store = new Ext.data.Store({
                model: 'pve-lxc-network',
                sorters: [
                    {
                        property: 'id',
                        direction: 'ASC',
                    },
                ],
            });

            let sm = Ext.create('Ext.selection.RowModel', {});

            let run_editor = function () {
                let rec = sm.getSelection()[0];
                if (!rec || !caps.vms['VM.Config.Network']) {
                    return false; // disable default-propagation when triggered by grid dblclick
                }
                Ext.create('PVE.lxc.NetworkEdit', {
                    url: me.url,
                    nodename: nodename,
                    dataCache: me.dataCache,
                    ifname: rec.data.id,
                    listeners: {
                        destroy: () => me.load(),
                    },
                    autoShow: true,
                });
                return undefined;
            };

            Ext.apply(me, {
                store: store,
                selModel: sm,
                tbar: [
                    {
                        text: gettext('Add'),
                        name: 'addButton',
                        disabled: !caps.vms['VM.Config.Network'],
                        handler: function () {
                            Ext.create('PVE.lxc.NetworkEdit', {
                                url: me.url,
                                nodename: nodename,
                                isCreate: true,
                                dataCache: me.dataCache,
                                listeners: {
                                    destroy: () => me.load(),
                                },
                                autoShow: true,
                            });
                        },
                    },
                    {
                        xtype: 'proxmoxButton',
                        text: gettext('Remove'),
                        disabled: true,
                        selModel: sm,
                        enableFn: function (rec) {
                            return !!caps.vms['VM.Config.Network'];
                        },
                        confirmMsg: ({ data }) =>
                            Ext.String.format(
                                gettext('Are you sure you want to remove entry {0}'),
                                `'${data.id}'`,
                            ),
                        handler: function (btn, e, rec) {
                            Proxmox.Utils.API2Request({
                                url: me.url,
                                waitMsgTarget: me,
                                method: 'PUT',
                                params: {
                                    delete: rec.data.id,
                                    digest: me.dataCache.digest,
                                },
                                callback: () => me.load(),
                                failure: (response, opts) =>
                                    Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                            });
                        },
                    },
                    {
                        xtype: 'proxmoxButton',
                        text: gettext('Edit'),
                        selModel: sm,
                        disabled: true,
                        enableFn: (rec) => !!caps.vms['VM.Config.Network'],
                        handler: run_editor,
                    },
                ],
                columns: [
                    {
                        header: 'ID',
                        width: 50,
                        dataIndex: 'id',
                    },
                    {
                        header: gettext('Name'),
                        width: 80,
                        dataIndex: 'name',
                    },
                    {
                        header: gettext('Bridge'),
                        width: 80,
                        dataIndex: 'bridge',
                    },
                    {
                        header: gettext('Firewall'),
                        width: 80,
                        dataIndex: 'firewall',
                        renderer: Proxmox.Utils.format_boolean,
                    },
                    {
                        header: gettext('VLAN Tag'),
                        width: 70,
                        dataIndex: 'tag',
                    },
                    {
                        header: gettext('MAC address'),
                        width: 110,
                        dataIndex: 'hwaddr',
                    },
                    {
                        header: gettext('IP address'),
                        width: 300,
                        dataIndex: 'ip',
                        renderer: function (_value, _metaData, rec) {
                            const formatIpValue = (value, prefix) => {
                                if (Array.isArray(value) && value.length > 0) {
                                    // multiple addresses (usually from the api)
                                    return value.join('<br>') + '<br>';
                                } else if (typeof value === 'string') {
                                    if (value === 'dhcp') {
                                        // ipv4 and ipv6 dhcp
                                        return `${prefix}dhcp <br>`;
                                    } else if (value === 'auto') {
                                        // ipv6 slaac
                                        return `${prefix}auto <br>`;
                                    } else if (value.length > 0) {
                                        // single address (usually from config)
                                        return value + '<br>';
                                    }
                                }
                                return '';
                            };

                            return (
                                formatIpValue(rec.data.ip, 'ip: ') +
                                formatIpValue(rec.data.ip6, 'ip6: ')
                            );
                        },
                    },
                    {
                        header: gettext('Gateway'),
                        width: 150,
                        dataIndex: 'gw',
                        renderer: function (value, metaData, rec) {
                            if (rec.data.gw && rec.data.gw6) {
                                return rec.data.gw + '<br>' + rec.data.gw6;
                            } else if (rec.data.gw6) {
                                return rec.data.gw6;
                            } else {
                                return rec.data.gw;
                            }
                        },
                    },
                    {
                        header: gettext('MTU'),
                        width: 80,
                        dataIndex: 'mtu',
                    },
                    {
                        header: gettext('Disconnected'),
                        width: 100,
                        dataIndex: 'link_down',
                        renderer: Proxmox.Utils.format_boolean,
                    },
                ],
                listeners: {
                    activate: me.load,
                    itemdblclick: run_editor,
                },
            });

            me.callParent();
        },
    },
    function () {
        Ext.define('pve-lxc-network', {
            extend: 'Ext.data.Model',
            proxy: { type: 'memory' },
            fields: [
                'id',
                'name',
                'hwaddr',
                'bridge',
                'ip',
                'gw',
                'ip6',
                'gw6',
                'tag',
                'firewall',
                'mtu',
                'link_down',
            ],
        });
    },
);
