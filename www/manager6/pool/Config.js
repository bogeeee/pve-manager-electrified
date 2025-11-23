Ext.define('PVE.pool.Config', {
    extend: 'PVE.panel.Config',
    alias: 'widget.pvePoolConfig',

    onlineHelp: 'pveum_pools',

    initComponent: function () {
        var me = this;

        var pool = me.pveSelNode.data.pool;
        if (!pool) {
            throw 'no pool specified';
        }

        Ext.apply(me, {
            title: Ext.String.format(gettext('Resource Pool') + ': ' + pool),
            hstateid: 'pooltab',
            items: [
                {
                    title: gettext('Summary'),
                    iconCls: 'fa fa-book',
                    xtype: 'pvePoolSummary',
                    itemId: 'summary',
                },
                {
                    title: gettext('Members'),
                    xtype: 'pvePoolMembers',
                    iconCls: 'fa fa-th',
                    pool: pool,
                    itemId: 'members',
                },
                {
                    xtype: 'pveACLView',
                    title: gettext('Permissions'),
                    iconCls: 'fa fa-unlock',
                    itemId: 'permissions',
                    path: '/pool/' + pool,
                },
            ],
        });

        me.callParent();
    },
});
