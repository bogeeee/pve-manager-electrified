/*
 * This class describes the bottom panel
 */
Ext.define('PVE.panel.StatusPanel', {
    extend: 'Ext.tab.Panel',
    alias: 'widget.pveStatusPanel',

    //title: "Logs",
    //tabPosition: 'bottom',

    initComponent: function () {
        var me = this;

        var stateid = 'ltab';
        var sp = Ext.state.Manager.getProvider();

        var state = sp.get(stateid);
        if (state && state.value) {
            me.activeTab = state.value;
        }

        Ext.apply(me, {
            listeners: {
                tabchange: function () {
                    var atab = me.getActiveTab().itemId;
                    let tabstate = { value: atab };
                    sp.set(stateid, tabstate);
                },
            },
            items: [
                {
                    itemId: 'tasks',
                    title: gettext('Tasks'),
                    xtype: 'pveClusterTasks',
                },
                {
                    itemId: 'clog',
                    title: gettext('Cluster log'),
                    xtype: 'pveClusterLog',
                },
            ],
        });

        me.callParent();

        me.items.get(0).fireEvent('show', me.items.get(0));

        var statechange = function (_, key, newstate) {
            if (key === stateid) {
                let atab = me.getActiveTab().itemId;
                let ntab = newstate.value;
                if (newstate && ntab && atab !== ntab) {
                    me.setActiveTab(ntab);
                }
            }
        };

        sp.on('statechange', statechange);
        me.on('destroy', function () {
            sp.un('statechange', statechange);
        });
    },
});
