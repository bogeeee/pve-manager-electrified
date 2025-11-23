Ext.define('PVE.sdn.Fabric.OpenFabric.Node.Edit', {
    extend: 'PVE.sdn.Fabric.Node.Edit',
    protocol: 'openfabric',

    extraRequestParams: {
        protocol: 'openfabric',
    },

    additionalItems: [
        {
            xtype: 'proxmoxtextfield',
            fieldLabel: gettext('IPv6'),
            labelWidth: 120,
            name: 'ip6',
            allowBlank: true,
            skipEmptyText: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
    ],
});
