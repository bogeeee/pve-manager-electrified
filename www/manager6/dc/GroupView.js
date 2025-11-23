Ext.define('PVE.dc.GroupView', {
    extend: 'Ext.grid.GridPanel',

    alias: ['widget.pveGroupView'],

    onlineHelp: 'pveum_groups',

    stateful: true,
    stateId: 'grid-groups',

    initComponent: function () {
        var me = this;

        var store = new Ext.data.Store({
            model: 'pve-groups',
            sorters: {
                property: 'groupid',
                direction: 'ASC',
            },
        });

        var reload = function () {
            store.load();
        };

        var sm = Ext.create('Ext.selection.RowModel', {});

        var remove_btn = Ext.create('Proxmox.button.StdRemoveButton', {
            selModel: sm,
            callback: function () {
                reload();
            },
            baseurl: '/access/groups/',
        });

        var run_editor = function () {
            var rec = sm.getSelection()[0];
            if (!rec) {
                return;
            }

            var win = Ext.create('PVE.dc.GroupEdit', {
                groupid: rec.data.groupid,
            });
            win.on('destroy', reload);
            win.show();
        };

        var edit_btn = new Proxmox.button.Button({
            text: gettext('Edit'),
            disabled: true,
            selModel: sm,
            handler: run_editor,
        });

        var tbar = [
            {
                text: gettext('Create'),
                handler: function () {
                    var win = Ext.create('PVE.dc.GroupEdit', {});
                    win.on('destroy', reload);
                    win.show();
                },
            },
            edit_btn,
            remove_btn,
        ];

        Proxmox.Utils.monStoreErrors(me, store);

        Ext.apply(me, {
            store: store,
            selModel: sm,
            tbar: tbar,
            viewConfig: {
                trackOver: false,
            },
            columns: [
                {
                    header: gettext('Name'),
                    width: 200,
                    sortable: true,
                    dataIndex: 'groupid',
                },
                {
                    header: gettext('Comment'),
                    sortable: false,
                    renderer: Ext.String.htmlEncode,
                    dataIndex: 'comment',
                    flex: 1,
                },
                {
                    header: gettext('Users'),
                    sortable: false,
                    dataIndex: 'users',
                    renderer: Ext.String.htmlEncode,
                    flex: 1,
                },
            ],
            listeners: {
                activate: reload,
                itemdblclick: run_editor,
            },
        });

        me.callParent();
    },
});
