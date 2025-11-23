Ext.define('PVE.dc.AuthView', {
    extend: 'Ext.grid.GridPanel',

    alias: ['widget.pveAuthView'],

    onlineHelp: 'pveum_authentication_realms',

    stateful: true,
    stateId: 'grid-authrealms',

    viewConfig: {
        trackOver: false,
    },

    columns: [
        {
            header: gettext('Realm'),
            width: 100,
            sortable: true,
            dataIndex: 'realm',
        },
        {
            header: gettext('Type'),
            width: 100,
            sortable: true,
            dataIndex: 'type',
        },
        {
            header: gettext('TFA'),
            width: 100,
            sortable: true,
            dataIndex: 'tfa',
        },
        {
            header: gettext('Comment'),
            sortable: false,
            dataIndex: 'comment',
            renderer: Ext.String.htmlEncode,
            flex: 1,
        },
    ],

    store: {
        model: 'pmx-domains',
        sorters: {
            property: 'realm',
            direction: 'ASC',
        },
    },

    openEditWindow: function (authType, realm) {
        let me = this;
        Ext.create('PVE.dc.AuthEditBase', {
            authType,
            realm,
            listeners: {
                destroy: () => me.reload(),
            },
        }).show();
    },

    reload: function () {
        let me = this;
        me.getStore().load();
    },

    run_editor: function () {
        let me = this;
        let rec = me.getSelection()[0];
        if (!rec) {
            return;
        }
        me.openEditWindow(rec.data.type, rec.data.realm);
    },

    open_sync_window: function () {
        let me = this;
        let rec = me.getSelection()[0];
        if (!rec) {
            return;
        }
        Ext.create('PVE.dc.SyncWindow', {
            realm: rec.data.realm,
            listeners: {
                destroy: () => me.reload(),
            },
        }).show();
    },

    initComponent: function () {
        var me = this;

        let items = [];
        for (const [authType, config] of Object.entries(PVE.Utils.authSchema)) {
            if (!config.add) {
                continue;
            }
            items.push({
                text: config.name,
                iconCls: 'fa fa-fw ' + (config.iconCls || 'fa-address-book-o'),
                handler: () => me.openEditWindow(authType),
            });
        }

        Ext.apply(me, {
            tbar: [
                {
                    text: gettext('Add'),
                    menu: {
                        items: items,
                    },
                },
                {
                    xtype: 'proxmoxButton',
                    text: gettext('Edit'),
                    disabled: true,
                    handler: () => me.run_editor(),
                },
                {
                    xtype: 'proxmoxStdRemoveButton',
                    baseurl: '/access/domains/',
                    enableFn: (rec) => PVE.Utils.authSchema[rec.data.type].add,
                    callback: () => me.reload(),
                },
                '-',
                {
                    xtype: 'proxmoxButton',
                    text: gettext('Sync'),
                    disabled: true,
                    enableFn: (rec) => Boolean(PVE.Utils.authSchema[rec.data.type].syncipanel),
                    handler: () => me.open_sync_window(),
                },
            ],
            listeners: {
                itemdblclick: () => me.run_editor(),
            },
        });

        me.callParent();
        me.reload();
    },
});
