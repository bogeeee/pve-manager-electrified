Ext.define('PVE.form.NodeSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: ['widget.pveNodeSelector'],

    // invalidate nodes which are offline
    onlineValidator: false,

    selectCurNode: false,

    // do not allow those nodes (array)
    disallowedNodes: undefined,

    // only allow those nodes (array)
    allowedNodes: undefined,

    valueField: 'node',
    displayField: 'node',
    store: {
        fields: ['node', 'cpu', 'maxcpu', 'mem', 'maxmem', 'uptime'],
        proxy: {
            type: 'proxmox',
            url: '/api2/json/nodes',
        },
        sorters: [
            {
                property: 'node',
                direction: 'ASC',
            },
            {
                property: 'mem',
                direction: 'DESC',
            },
        ],
    },

    listConfig: {
        columns: [
            {
                header: gettext('Node'),
                dataIndex: 'node',
                sortable: true,
                hideable: false,
                flex: 1,
            },
            {
                header: gettext('Memory usage') + ' %',
                renderer: PVE.Utils.render_mem_usage_percent,
                sortable: true,
                width: 100,
                dataIndex: 'mem',
            },
            {
                header: gettext('CPU usage'),
                renderer: Proxmox.Utils.render_cpu,
                sortable: true,
                width: 100,
                dataIndex: 'cpu',
            },
        ],
    },

    validator: function (value) {
        let me = this;
        if (!me.onlineValidator || (me.allowBlank && !value)) {
            return true;
        }

        let offline = [],
            notAllowed = [];
        Ext.Array.each(value.split(/\s*,\s*/), function (node) {
            let rec = me.store.findRecord(me.valueField, node, 0, false, true, true);
            if (!(rec && rec.data) || rec.data.status !== 'online') {
                offline.push(node);
            } else if (me.allowedNodes && !Ext.Array.contains(me.allowedNodes, node)) {
                notAllowed.push(node);
            }
        });

        if (value && notAllowed.length !== 0) {
            return 'Node ' + notAllowed.join(', ') + ' is not allowed for this action!';
        }
        if (value && offline.length !== 0) {
            return 'Node ' + offline.join(', ') + ' seems to be offline!';
        }
        return true;
    },

    initComponent: function () {
        var me = this;

        if (me.selectCurNode && PVE.curSelectedNode && PVE.curSelectedNode.data.node) {
            me.preferredValue = PVE.curSelectedNode.data.node;
        }

        me.callParent();
        me.getStore().load();

        me.getStore().addFilter(
            new Ext.util.Filter({
                // filter out disallowed nodes
                filterFn: (item) =>
                    !(me.disallowedNodes && me.disallowedNodes.includes(item.data.node)),
            }),
        );

        me.mon(me.getStore(), 'load', () => me.isValid());
    },
});
