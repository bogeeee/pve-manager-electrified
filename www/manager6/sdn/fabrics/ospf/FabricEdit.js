Ext.define('PVE.sdn.Fabric.Ospf.Fabric.Edit', {
    extend: 'PVE.sdn.Fabric.Fabric.Edit',

    subject: 'OSPF',
    onlineHelp: 'pvesdn_ospf_fabric',

    extraRequestParams: {
        protocol: 'ospf',
    },

    additionalItems: [
        {
            xtype: 'textfield',
            fieldLabel: gettext('Area'),
            labelWidth: 120,
            name: 'area',
            emptyText: '0',
            allowBlank: false,
        },
    ],
});
