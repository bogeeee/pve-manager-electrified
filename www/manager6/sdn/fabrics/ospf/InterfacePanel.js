Ext.define('PVE.sdn.Fabric.Ospf.NetworkTypeSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: ['widget.pveOspfNetworkTypeSelector'],

    valueField: 'name',
    displayField: 'name',

    emptyText: 'auto',

    listConfig: {
        columns: [
            {
                header: gettext('NetworkType'),
                dataIndex: 'name',
                hideable: false,
                sortable: true,
                flex: 3,
            },
        ],
        width: 360,
    },

    store: {
        fields: ['name'],
        data: [
            { name: 'broadcast' },
            { name: 'non-broadcast' },
            { name: 'point-to-multipoint' },
            { name: 'point-to-point' },
        ],
    },
});

Ext.define('PVE.sdn.Fabric.Ospf.InterfacePanel', {
    extend: 'PVE.sdn.Fabric.InterfacePanel',

    hasIpv6Support: false,

    additionalColumns: [
        {
            text: gettext('Network Type'),
            xtype: 'widgetcolumn',
            dataIndex: 'network_type',
            flex: 1,
            widget: {
                xtype: 'pveOspfNetworkTypeSelector',
                isFormField: false,
                bind: {
                    disabled: '{record.isDisabled}',
                },
            },
        },
    ],
});
