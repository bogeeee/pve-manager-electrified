Ext.define('PVE.sdn.Fabric.Ospf.Fabric.Edit', {
    extend: 'PVE.sdn.Fabric.Fabric.Edit',

    subject: 'OSPF',
    onlineHelp: 'pvesdn_ospf_fabric',

    hasIpv6Support: false,

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
        {
            xtype: 'pveSDNPrefixListSelector',
            name: 'route_filter',
            fieldLabel: gettext('Route Filter'),
            labelWidth: 120,
            emptyText: gettext('IP Prefixes'),
            deleteEmpty: true,
            skipEmptyText: true,
        },
    ],

    additionalTabs: [
        {
            xtype: 'inputpanel',
            title: gettext('Route Redistribution'),
            items: [
                {
                    xtype: 'pveSDNRedistributionGrid',
                    name: 'redistribute',
                    sources: [
                        ['bgp', gettext('BGP')],
                        ['connected', gettext('Connected')],
                        ['static', gettext('Static')],
                        ['kernel', gettext('Kernel')],
                    ],
                },
            ],
        },
    ],
});
