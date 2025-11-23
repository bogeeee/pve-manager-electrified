Ext.define('PVE.sdn.Fabric.OpenFabric.InterfacePanel', {
    extend: 'PVE.sdn.Fabric.InterfacePanel',

    additionalColumns: [
        {
            text: gettext('IPv6'),
            xtype: 'widgetcolumn',
            dataIndex: 'ip6',
            flex: 1,
            widget: {
                xtype: 'proxmoxtextfield',
                isFormField: false,
                bind: {
                    disabled: '{record.isDisabled}',
                },
            },
        },
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
