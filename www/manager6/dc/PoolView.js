Ext.define('PVE.dc.PoolView', {
    extend: 'Ext.grid.GridPanel',

    alias: ['widget.pvePoolView'],

    onlineHelp: 'pveum_pools',

    stateful: true,
    stateId: 'grid-pools',

    initComponent: function () {
        var me = this;

        var store = new Ext.data.Store({
            model: 'pve-pools',
            sorters: {
                property: 'poolid',
                direction: 'ASC',
            },
        });

        var reload = function () {
            store.load();
        };

        var sm = Ext.create('Ext.selection.RowModel', {});

        var remove_btn = Ext.create('Proxmox.button.StdRemoveButton', {
            selModel: sm,
            baseurl: '/pools/',
            callback: function () {
                reload();
            },
            getUrl: function (rec) {
                return '/pools/?poolid=' + rec.getId();
            },
        });

        var run_editor = function () {
            var rec = sm.getSelection()[0];
            if (!rec) {
                return;
            }

            var win = Ext.create('PVE.dc.PoolEdit', {
                poolid: rec.data.poolid,
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
                    var win = Ext.create('PVE.dc.PoolEdit', {});
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
                    dataIndex: 'poolid',
                },
                {
                    header: gettext('Comment'),
                    sortable: false,
                    renderer: Ext.String.htmlEncode,
                    dataIndex: 'comment',
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
