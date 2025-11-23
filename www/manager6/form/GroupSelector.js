Ext.define('pve-groups', {
    extend: 'Ext.data.Model',
    fields: ['groupid', 'comment', 'users'],
    proxy: {
        type: 'proxmox',
        url: '/api2/json/access/groups',
    },
    idProperty: 'groupid',
});

Ext.define('PVE.form.GroupSelector', {
    extend: 'Proxmox.form.ComboGrid',
    xtype: 'pveGroupSelector',

    editable: true,
    anyMatch: true,
    forceSelection: true,

    allowBlank: false,
    autoSelect: false,
    valueField: 'groupid',
    displayField: 'groupid',
    listConfig: {
        columns: [
            {
                header: gettext('Group'),
                sortable: true,
                dataIndex: 'groupid',
                flex: 1,
            },
            {
                header: gettext('Comment'),
                sortable: false,
                dataIndex: 'comment',
                renderer: Ext.String.htmlEncode,
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
    },

    initComponent: function () {
        var me = this;

        var store = new Ext.data.Store({
            model: 'pve-groups',
            sorters: [
                {
                    property: 'groupid',
                },
            ],
        });

        Ext.apply(me, {
            store: store,
        });

        me.callParent();

        store.load();
    },
});
