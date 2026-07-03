Ext.define('PVE.sdn.Fabric.OpenFabric.InterfacePanel', {
    extend: 'PVE.sdn.Fabric.InterfacePanel',

    additionalColumns: [
        {
            text: gettext('Hello Multiplier'),
            xtype: 'widgetcolumn',
            dataIndex: 'hello_multiplier',
            flex: 1,
            hidden: true,
            widget: {
                xtype: 'proxmoxintegerfield',
                isFormField: false,
                emptyText: '10',
                bind: {
                    disabled: '{record.isDisabled}',
                },
            },
        },
    ],
});
