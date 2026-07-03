Ext.define('PVE.sdn.Fabric.Bgp.Fabric.Edit', {
    extend: 'PVE.sdn.Fabric.Fabric.Edit',

    subject: 'BGP',
    onlineHelp: 'pvesdn_bgp_fabric',

    extraRequestParams: {
        protocol: 'bgp',
    },

    additionalItems: [
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('BFD'),
            labelWidth: 120,
            name: 'bfd',
            uncheckedValue: 0,
            defaultValue: 0,
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

    additionalAdvancedItems: [
        {
            xtype: 'pveSDNRouteMapSelector',
            name: 'route_map_in',
            // TRANSLATORS: "Route map" refers to an FRR route map, some
            // languages may prefer to keep it as-is:
            // https://docs.frrouting.org/en/latest/routemap.html
            fieldLabel: gettext('Incoming Route Map'),
            labelWidth: 120,
            // TRANSLATORS: "Route map" refers to an FRR route map, some
            // languages may prefer to keep it as-is:
            // https://docs.frrouting.org/en/latest/routemap.html
            emptyText: gettext('Route Map'),
            deleteEmpty: true,
            skipEmptyText: true,
        },
        {
            xtype: 'pveSDNRouteMapSelector',
            name: 'route_map_out',
            // TRANSLATORS: "Route map" refers to an FRR route map, some
            // languages may prefer to keep it as-is:
            // https://docs.frrouting.org/en/latest/routemap.html
            fieldLabel: gettext('Outgoing Route Map'),
            labelWidth: 120,
            // TRANSLATORS: "Route map" refers to an FRR route map, some
            // languages may prefer to keep it as-is:
            // https://docs.frrouting.org/en/latest/routemap.html
            emptyText: gettext('Route Map'),
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
                        ['ospf', gettext('OSPF')],
                        ['connected', gettext('Connected')],
                        ['static', gettext('Static')],
                        ['kernel', gettext('Kernel')],
                    ],
                },
            ],
        },
    ],
});
