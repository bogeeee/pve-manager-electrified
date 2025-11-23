Ext.define('PVE.dc.RoleView', {
    extend: 'Ext.grid.GridPanel',

    alias: ['widget.pveRoleView'],

    onlineHelp: 'pveum_roles',

    stateful: true,
    stateId: 'grid-roles',

    initComponent: function () {
        let me = this;

        let store = new Ext.data.Store({
            model: 'pmx-roles',
            sorters: {
                property: 'roleid',
                direction: 'ASC',
            },
        });
        Proxmox.Utils.monStoreErrors(me, store);

        let sm = Ext.create('Ext.selection.RowModel', {});
        let run_editor = function () {
            let rec = sm.getSelection()[0];
            if (!rec) {
                return;
            }
            if (rec.data.special) {
                return;
            }
            Ext.create('PVE.dc.RoleEdit', {
                roleid: rec.data.roleid,
                privs: rec.data.privs,
                listeners: {
                    destroy: () => store.load(),
                },
                autoShow: true,
            });
        };

        Ext.apply(me, {
            store: store,
            selModel: sm,

            viewConfig: {
                trackOver: false,
            },
            columns: [
                {
                    header: gettext('Built-In'),
                    width: 65,
                    sortable: true,
                    dataIndex: 'special',
                    renderer: Proxmox.Utils.format_boolean,
                },
                {
                    header: gettext('Name'),
                    width: 150,
                    sortable: true,
                    dataIndex: 'roleid',
                },
                {
                    itemid: 'privs',
                    header: gettext('Privileges'),
                    sortable: false,
                    renderer: (value, metaData) => {
                        if (!value) {
                            return '-';
                        }
                        metaData.style = 'white-space:normal;'; // allow word wrap
                        return value.replace(/,/g, ' ');
                    },
                    variableRowHeight: true,
                    dataIndex: 'privs',
                    flex: 1,
                },
            ],
            listeners: {
                activate: function () {
                    store.load();
                },
                itemdblclick: run_editor,
            },
            tbar: [
                {
                    text: gettext('Create'),
                    handler: function () {
                        Ext.create('PVE.dc.RoleEdit', {
                            listeners: {
                                destroy: () => store.load(),
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
                    enableFn: (rec) => !rec.data.special,
                },
                {
                    xtype: 'proxmoxStdRemoveButton',
                    selModel: sm,
                    callback: () => store.load(),
                    baseurl: '/access/roles/',
                    enableFn: (rec) => !rec.data.special,
                },
            ],
        });

        me.callParent();
    },
});
