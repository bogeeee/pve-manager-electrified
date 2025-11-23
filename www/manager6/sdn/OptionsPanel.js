Ext.define('PVE.sdn.Options', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveSDNOptions',

    title: 'Options',

    layout: {
        type: 'vbox',
        align: 'stretch',
    },

    onlineHelp: 'pvesdn_config_controllers',

    items: [
        {
            xtype: 'pveSDNControllerView',
            title: gettext('Controllers'),
            flex: 1,
            padding: '0 0 20 0',
            border: 0,
        },
        {
            xtype: 'pveSDNIpamView',
            title: 'IPAM',
            flex: 1,
            padding: '0 0 20 0',
            border: 0,
        },
        {
            xtype: 'pveSDNDnsView',
            title: 'DNS',
            flex: 1,
            border: 0,
        },
    ],
});
