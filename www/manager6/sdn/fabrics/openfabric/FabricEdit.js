Ext.define('PVE.sdn.Fabric.OpenFabric.Fabric.Edit', {
    extend: 'PVE.sdn.Fabric.Fabric.Edit',

    subject: 'OpenFabric',
    onlineHelp: 'pvesdn_openfabric_fabric',

    extraRequestParams: {
        protocol: 'openfabric',
    },

    additionalItems: [
        {
            xtype: 'proxmoxintegerfield',
            // TRANSLATORS: See https://en.wikipedia.org/wiki/IS-IS#Packet_types
            fieldLabel: gettext('Hello Interval'),
            labelWidth: 120,
            name: 'hello_interval',
            allowBlank: true,
            emptyText: '3',
            skipEmptyText: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            // TRANSLATORS: Stands for Complete Sequence Number Packet, see
            // https://datatracker.ietf.org/doc/html/draft-ietf-lsr-distoptflood#name-flooding-failures
            fieldLabel: gettext('CSNP Interval'),
            labelWidth: 120,
            name: 'csnp_interval',
            allowBlank: true,
            emptyText: '10',
            skipEmptyText: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
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
});
