Ext.define('PVE.pool.StatusView', {
    extend: 'Proxmox.grid.ObjectGrid',
    alias: ['widget.pvePoolStatusView'],
    disabled: true,

    title: gettext('Status'),
    cwidth1: 150,
    interval: 30000,
    //height: 195,
    initComponent: function () {
        var me = this;

        var pool = me.pveSelNode.data.pool;
        if (!pool) {
            throw 'no pool specified';
        }

        var rows = {
            comment: {
                header: gettext('Comment'),
                renderer: Ext.String.htmlEncode,
                required: true,
            },
        };

        Ext.apply(me, {
            url: '/api2/json/pools/?poolid=' + pool,
            rows: rows,
        });

        me.callParent();
    },
});
