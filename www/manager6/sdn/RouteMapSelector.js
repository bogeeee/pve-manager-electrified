Ext.define('PVE.sdn.RouteMap', {
    extend: 'Ext.data.Model',
    fields: ['id'],
});

Ext.define('PVE.sdn.RouteMapSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: 'widget.pveSDNRouteMapSelector',

    displayField: 'id',

    deleteEmpty: true,
    editable: false,
    allowBlank: true,
    autoSelect: false,

    config: {
        value: null,
    },

    store: {
        autoLoad: true,
        model: 'PVE.sdn.RouteMap',
        proxy: {
            type: 'proxmox',
            url: '/api2/json/cluster/sdn/route-maps',
        },
    },
    listConfig: {
        columns: [
            {
                header: gettext('Name'),
                dataIndex: 'id',
                hideable: false,
                flex: 1,
            },
        ],
    },
});
