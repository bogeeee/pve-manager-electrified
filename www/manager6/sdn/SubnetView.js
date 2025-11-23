Ext.define(
    'PVE.sdn.SubnetView',
    {
        extend: 'Ext.grid.GridPanel',
        alias: 'widget.pveSDNSubnetView',

        stateful: true,
        stateId: 'grid-sdn-subnet',

        base_url: undefined,

        remove_btn: undefined,

        setBaseUrl: function (url) {
            let me = this;

            me.base_url = url;

            if (url === undefined) {
                me.store.removeAll();
                me.create_btn.disable();
            } else {
                me.remove_btn.baseurl = url + '/';
                me.store.setProxy({
                    type: 'proxmox',
                    url: '/api2/json/' + url + '?pending=1',
                });
                me.create_btn.enable();
                me.store.load();
            }
        },

        initComponent: function () {
            let me = this;

            let store = new Ext.data.Store({
                model: 'pve-sdn-subnet',
            });

            let reload = function () {
                store.load();
            };

            let sm = Ext.create('Ext.selection.RowModel', {});

            let run_editor = function () {
                let rec = sm.getSelection()[0];

                let win = Ext.create('PVE.sdn.SubnetEdit', {
                    autoShow: true,
                    subnet: rec.data.subnet,
                    base_url: me.base_url,
                });
                win.on('destroy', reload);
            };

            me.create_btn = new Proxmox.button.Button({
                text: gettext('Create'),
                disabled: true,
                handler: function () {
                    let win = Ext.create('PVE.sdn.SubnetEdit', {
                        autoShow: true,
                        base_url: me.base_url,
                        type: 'subnet',
                    });
                    win.on('destroy', reload);
                },
            });

            let edit_btn = new Proxmox.button.Button({
                text: gettext('Edit'),
                disabled: true,
                selModel: sm,
                handler: run_editor,
            });

            me.remove_btn = Ext.create('Proxmox.button.StdRemoveButton', {
                selModel: sm,
                baseurl: me.base_url + '/',
                callback: () => store.load(),
            });

            let set_button_status = function () {
                var rec = me.selModel.getSelection()[0];

                if (!rec || rec.data.state === 'deleted') {
                    edit_btn.disable();
                    me.remove_btn.disable();
                }
            };

            Ext.apply(me, {
                store: store,
                reloadStore: reload,
                selModel: sm,
                viewConfig: {
                    trackOver: false,
                },
                tbar: [me.create_btn, me.remove_btn, edit_btn],
                columns: [
                    {
                        header: gettext('Subnet'),
                        flex: 2,
                        dataIndex: 'cidr',
                        renderer: function (value, metaData, rec) {
                            return PVE.Utils.render_sdn_pending(rec, value, 'cidr', 1);
                        },
                    },
                    {
                        header: gettext('Gateway'),
                        flex: 1,
                        dataIndex: 'gateway',
                        renderer: function (value, metaData, rec) {
                            return PVE.Utils.render_sdn_pending(rec, value, 'gateway');
                        },
                    },
                    {
                        header: 'SNAT',
                        flex: 1,
                        dataIndex: 'snat',
                        renderer: function (value, metaData, rec) {
                            return PVE.Utils.render_sdn_pending(rec, value, 'snat');
                        },
                    },
                    {
                        header: gettext('DNS Prefix'),
                        flex: 1,
                        dataIndex: 'dnszoneprefix',
                        renderer: function (value, metaData, rec) {
                            return PVE.Utils.render_sdn_pending(rec, value, 'dnszoneprefix');
                        },
                    },
                    {
                        header: gettext('State'),
                        width: 100,
                        dataIndex: 'state',
                        renderer: function (value, metaData, rec) {
                            return PVE.Utils.render_sdn_pending_state(rec, value);
                        },
                    },
                ],
                listeners: {
                    activate: reload,
                    itemdblclick: run_editor,
                    selectionchange: set_button_status,
                },
            });

            me.callParent();

            if (me.base_url) {
                me.setBaseUrl(me.base_url); // load
            }
        },
    },
    function () {
        Ext.define('pve-sdn-subnet', {
            extend: 'Ext.data.Model',
            fields: ['cidr', 'gateway', 'snat'],
            idProperty: 'subnet',
        });
    },
);
