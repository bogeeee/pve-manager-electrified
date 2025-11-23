Ext.define(
    'PVE.ha.FencingView',
    {
        extend: 'Ext.grid.GridPanel',
        alias: ['widget.pveFencingView'],

        onlineHelp: 'ha_manager_fencing',

        initComponent: function () {
            var me = this;

            var store = new Ext.data.Store({
                model: 'pve-ha-fencing',
                data: [],
            });

            Ext.apply(me, {
                store: store,
                stateful: false,
                viewConfig: {
                    trackOver: false,
                    deferEmptyText: false,
                    emptyText: gettext('Use watchdog based fencing.'),
                },
                columns: [
                    {
                        header: gettext('Node'),
                        width: 100,
                        sortable: true,
                        dataIndex: 'node',
                    },
                    {
                        header: gettext('Command'),
                        flex: 1,
                        dataIndex: 'command',
                    },
                ],
            });

            me.callParent();
        },
    },
    function () {
        Ext.define('pve-ha-fencing', {
            extend: 'Ext.data.Model',
            fields: ['node', 'command', 'digest'],
        });
    },
);
