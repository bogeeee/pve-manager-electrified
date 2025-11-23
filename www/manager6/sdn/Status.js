Ext.define('PVE.sdn.Status', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveSDNStatus',

    onlineHelp: 'chapter_pvesdn',

    layout: {
        type: 'vbox',
        align: 'stretch',
    },

    initComponent: function () {
        var me = this;

        me.rstore = Ext.create('Proxmox.data.ObjectStore', {
            interval: me.interval,
            model: 'pve-sdn-status',
            storeid: 'pve-store-' + ++Ext.idSeed,
            groupField: 'type',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/resources',
            },
        });

        me.items = [
            {
                xtype: 'pveSDNStatusView',
                title: gettext('Status'),
                rstore: me.rstore,
                border: 0,
                collapsible: true,
                padding: '0 0 20 0',
            },
        ];

        me.callParent();
        me.on('activate', me.rstore.startUpdate);
    },
});
