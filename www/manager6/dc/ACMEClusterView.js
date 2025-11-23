Ext.define('pve-acme-accounts', {
    extend: 'Ext.data.Model',
    fields: ['name'],
    proxy: {
        type: 'proxmox',
        url: '/api2/json/cluster/acme/account',
    },
    idProperty: 'name',
});

Ext.define('pve-acme-plugins', {
    extend: 'Ext.data.Model',
    fields: ['type', 'plugin', 'api'],
    proxy: {
        type: 'proxmox',
        url: '/api2/json/cluster/acme/plugins',
    },
    idProperty: 'plugin',
});

Ext.define('PVE.dc.ACMEClusterView', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveACMEClusterView',

    onlineHelp: 'sysadmin_certificate_management',

    items: [
        {
            region: 'north',
            border: false,
            xtype: 'pmxACMEAccounts',
            acmeUrl: '/cluster/acme',
        },
        {
            region: 'center',
            border: false,
            xtype: 'pmxACMEPluginView',
            acmeUrl: '/cluster/acme',
        },
    ],
});
