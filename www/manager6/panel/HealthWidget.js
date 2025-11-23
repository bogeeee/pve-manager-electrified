Ext.define('PVE.widget.HealthWidget', {
    extend: 'Ext.Component',
    alias: 'widget.pveHealthWidget',

    data: {
        iconCls: PVE.Utils.get_health_icon(undefined, true),
        text: '',
        title: '',
    },

    style: {
        'text-align': 'center',
    },

    tpl: ['<h3>{title}</h3>', '<i class="fa fa-5x {iconCls}"></i>', '<br /><br/>', '{text}'],

    updateHealth: function (data) {
        var me = this;
        me.update(Ext.apply(me.data, data));
    },

    initComponent: function () {
        var me = this;

        if (me.title) {
            me.config.data.title = me.title;
        }

        me.callParent();
    },
});
