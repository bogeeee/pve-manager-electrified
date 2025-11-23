Ext.define('PVE.form.NotificationTargetSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: ['widget.pveNotificationTargetSelector'],

    // set default value to empty array, else it inits it with
    // null and after the store load it is an empty array,
    // triggering dirtychange
    value: [],
    valueField: 'name',
    displayField: 'name',
    deleteEmpty: true,
    skipEmptyText: true,

    store: {
        fields: ['name', 'type', 'comment'],
        proxy: {
            type: 'proxmox',
            url: '/api2/json/cluster/notifications/targets',
        },
        sorters: [
            {
                property: 'name',
                direction: 'ASC',
            },
        ],
        autoLoad: true,
    },

    listConfig: {
        columns: [
            {
                header: gettext('Target'),
                dataIndex: 'name',
                sortable: true,
                hideable: false,
                flex: 1,
            },
            {
                header: gettext('Type'),
                dataIndex: 'type',
                sortable: true,
                hideable: false,
                flex: 1,
            },
            {
                header: gettext('Comment'),
                dataIndex: 'comment',
                sortable: true,
                hideable: false,
                flex: 2,
            },
        ],
    },
});
