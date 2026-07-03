Ext.define('PVE.sdn.Fabric.WireGuard.Fabric.Edit', {
    extend: 'PVE.sdn.Fabric.Fabric.Edit',

    subject: 'WireGuard',
    onlineHelp: 'pvesdn_wireguard_fabric',

    extraRequestParams: {
        protocol: 'wireguard',
    },

    // handled in the interface configuration (for now)
    hasIpv4Support: false,
    hasIpv6Support: false,

    additionalItems: [
        {
            xtype: 'proxmoxintegerfield',
            // TRANSLATORS: 's' is the SI abbreviation for seconds, the unit of the value
            fieldLabel: gettext('Persistent Keepalive') + ' (s)',
            emptyText: gettext('off'),
            name: 'persistent_keepalive',
            minValue: 1,
            maxValue: 65535,
            labelWidth: 120,
            allowBlank: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
    ],
});
