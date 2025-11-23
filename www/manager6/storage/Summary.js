Ext.define('PVE.storage.Summary', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveStorageSummary',
    scrollable: true,
    bodyPadding: 5,
    tbar: [
        '->',
        {
            xtype: 'proxmoxRRDTypeSelector',
        },
    ],
    layout: {
        type: 'column',
    },
    defaults: {
        padding: 5,
        columnWidth: 1,
    },
    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        var storage = me.pveSelNode.data.storage;
        if (!storage) {
            throw 'no storage ID specified';
        }

        var rstore = Ext.create('Proxmox.data.ObjectStore', {
            url: '/api2/json/nodes/' + nodename + '/storage/' + storage + '/status',
            interval: 1000,
        });

        var rrdstore = Ext.create('Proxmox.data.RRDStore', {
            rrdurl: '/api2/json/nodes/' + nodename + '/storage/' + storage + '/rrddata',
            model: 'pve-rrd-storage',
        });

        Ext.apply(me, {
            items: [
                {
                    xtype: 'pveStorageStatusView',
                    pveSelNode: me.pveSelNode,
                    rstore: rstore,
                },
                {
                    xtype: 'proxmoxRRDChart',
                    title: gettext('Usage'),
                    fields: ['total', 'used'],
                    fieldTitles: ['Total Size', 'Used Size'],
                    store: rrdstore,
                    unit: 'bytes',
                },
            ],
            listeners: {
                activate: function () {
                    rstore.startUpdate();
                    rrdstore.startUpdate();
                },
                destroy: function () {
                    rstore.stopUpdate();
                    rrdstore.stopUpdate();
                },
            },
        });

        me.callParent();
    },
});
