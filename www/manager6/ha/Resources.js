Ext.define('PVE.ha.ResourcesView', {
    extend: 'Ext.grid.GridPanel',
    alias: ['widget.pveHAResourcesView'],

    onlineHelp: 'ha_manager_resources',

    stateful: true,
    stateId: 'grid-ha-resources',

    initComponent: function () {
        let me = this;

        if (!me.rstore) {
            throw 'no store given';
        }

        Proxmox.Utils.monStoreErrors(me, me.rstore);
        let store = Ext.create('Proxmox.data.DiffStore', {
            rstore: me.rstore,
            filters: {
                property: 'type',
                value: 'service',
            },
        });

        let sm = Ext.create('Ext.selection.RowModel', {});

        let run_editor = function () {
            let rec = sm.getSelection()[0];
            let sid = rec.data.sid;

            let res = sid.match(/^(\S+):(\S+)$/);
            if (!res || (res[1] !== 'vm' && res[1] !== 'ct')) {
                console.warn(`unknown HA service ID type ${sid}`);
                return;
            }
            let [, guestType, vmid] = res;
            Ext.create('PVE.ha.VMResourceEdit', {
                guestType: guestType,
                vmid: vmid,
                listeners: {
                    destroy: () => me.rstore.load(),
                },
                autoShow: true,
            });
        };

        let caps = Ext.state.Manager.get('GuiCap');

        Ext.apply(me, {
            store: store,
            selModel: sm,
            viewConfig: {
                trackOver: false,
            },
            tbar: [
                {
                    text: gettext('Add'),
                    disabled: !caps.nodes['Sys.Console'],
                    handler: function () {
                        Ext.create('PVE.ha.VMResourceEdit', {
                            listeners: {
                                destroy: () => me.rstore.load(),
                            },
                            autoShow: true,
                        });
                    },
                },
                {
                    xtype: 'proxmoxButton',
                    text: gettext('Edit'),
                    disabled: true,
                    selModel: sm,
                    handler: run_editor,
                },
                {
                    xtype: 'proxmoxButton',
                    text: gettext('Remove'),
                    selModel: sm,
                    itemId: 'removeBtn',
                    disabled: true,
                    handler: function (btn, e, rec) {
                        Ext.create('PVE.window.ConfirmRemoveResource', {
                            url: `/cluster/ha/resources/${rec.data.sid}`,
                            item: {
                                id: rec.data.sid,
                            },
                            apiCallDone: () => me.rstore.load(),
                        }).show();
                    },
                },
            ],
            columns: [
                {
                    header: 'ID',
                    width: 100,
                    sortable: true,
                    dataIndex: 'sid',
                },
                {
                    header: gettext('State'),
                    width: 100,
                    sortable: true,
                    dataIndex: 'state',
                },
                {
                    header: gettext('Node'),
                    width: 100,
                    sortable: true,
                    dataIndex: 'node',
                },
                {
                    header: gettext('Request State'),
                    width: 100,
                    hidden: true,
                    sortable: true,
                    renderer: (v) => v || 'started',
                    dataIndex: 'request_state',
                },
                {
                    header: gettext('CRM State'),
                    width: 100,
                    hidden: true,
                    sortable: true,
                    dataIndex: 'crm_state',
                },
                {
                    header: gettext('Name'),
                    width: 100,
                    sortable: true,
                    dataIndex: 'vname',
                },
                {
                    header: gettext('Max. Restart'),
                    width: 100,
                    sortable: true,
                    renderer: (v) => (v === undefined ? '1' : v),
                    dataIndex: 'max_restart',
                },
                {
                    header: gettext('Max. Relocate'),
                    width: 100,
                    sortable: true,
                    renderer: (v) => (v === undefined ? '1' : v),
                    dataIndex: 'max_relocate',
                },
                {
                    header: gettext('Failback'),
                    width: 100,
                    sortable: true,
                    dataIndex: 'failback',
                },
                {
                    header: gettext('Description'),
                    flex: 1,
                    renderer: Ext.String.htmlEncode,
                    dataIndex: 'comment',
                },
            ],
            listeners: {
                beforeselect: (grid, record, index, eOpts) => caps.nodes['Sys.Console'],
                itemdblclick: run_editor,
            },
        });

        me.callParent();
    },
});
