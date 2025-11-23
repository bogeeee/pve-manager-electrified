Ext.define('PVE.pool.Summary', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pvePoolSummary',

    initComponent: function () {
        var me = this;

        var pool = me.pveSelNode.data.pool;
        if (!pool) {
            throw 'no pool specified';
        }

        var statusview = Ext.create('PVE.pool.StatusView', {
            pveSelNode: me.pveSelNode,
            style: 'padding-top:0px',
        });

        var rstore = statusview.rstore;

        Ext.apply(me, {
            autoScroll: true,
            bodyStyle: 'padding:10px',
            defaults: {
                style: 'padding-top:10px',
                width: 800,
            },
            items: [statusview],
        });

        me.on('activate', rstore.startUpdate);
        me.on('destroy', rstore.stopUpdate);

        me.callParent();
    },
});
