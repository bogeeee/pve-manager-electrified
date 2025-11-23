Ext.define(
    'PVE.dc.NodeView',
    {
        extend: 'Ext.grid.GridPanel',
        alias: 'widget.pveDcNodeView',

        title: gettext('Nodes'),
        disableSelection: true,
        scrollable: true,

        columns: [
            {
                header: gettext('Name'),
                flex: 1,
                sortable: true,
                dataIndex: 'name',
            },
            {
                header: 'ID',
                width: 40,
                sortable: true,
                dataIndex: 'nodeid',
            },
            {
                header: gettext('Online'),
                width: 60,
                sortable: true,
                dataIndex: 'online',
                renderer: function (value) {
                    var cls = value ? 'good' : 'critical';
                    return '<i class="fa ' + PVE.Utils.get_health_icon(cls) + '"><i/>';
                },
            },
            {
                header: gettext('Support'),
                width: 100,
                sortable: true,
                dataIndex: 'level',
                renderer: PVE.Utils.render_support_level,
            },
            {
                header: gettext('Server Address'),
                width: 115,
                sortable: true,
                dataIndex: 'ip',
            },
            {
                header: gettext('CPU usage'),
                sortable: true,
                width: 110,
                dataIndex: 'cpuusage',
                tdCls: 'x-progressbar-default-cell',
                xtype: 'widgetcolumn',
                widget: {
                    xtype: 'pveProgressBar',
                },
            },
            {
                header: gettext('Memory usage'),
                width: 110,
                sortable: true,
                tdCls: 'x-progressbar-default-cell',
                dataIndex: 'memoryusage',
                xtype: 'widgetcolumn',
                widget: {
                    xtype: 'pveProgressBar',
                    warningThreshold: 0.9,
                    criticalThreshold: 0.975,
                },
            },
            {
                header: gettext('Uptime'),
                sortable: true,
                dataIndex: 'uptime',
                align: 'right',
                renderer: Proxmox.Utils.render_uptime,
            },
        ],

        stateful: true,
        stateId: 'grid-cluster-nodes',
        tools: [
            {
                type: 'up',
                handler: function () {
                    let view = this.up('grid');
                    view.setHeight(Math.max(view.getHeight() - 50, 250));
                },
            },
            {
                type: 'down',
                handler: function () {
                    let view = this.up('grid');
                    view.setHeight(view.getHeight() + 50);
                },
            },
        ],
    },
    function () {
        Ext.define('pve-dc-nodes', {
            extend: 'Ext.data.Model',
            fields: ['id', 'type', 'name', 'nodeid', 'ip', 'level', 'local', 'online'],
            idProperty: 'id',
        });
    },
);

Ext.define('PVE.widget.ProgressBar', {
    extend: 'Ext.Progress',
    alias: 'widget.pveProgressBar',

    animate: true,
    textTpl: ['{percent}%'],

    warningThreshold: 0.8,
    criticalThreshold: 0.9,

    setValue: function (value) {
        let me = this;

        me.callParent([value]);

        me.removeCls(['warning', 'critical']);

        if (value >= me.criticalThreshold) {
            me.addCls('critical');
        } else if (value >= me.warningThreshold) {
            me.addCls('warning');
        }
    },
});
