Ext.define('PVE.ha.rules.NodeAffinityInputPanel', {
    extend: 'PVE.ha.RuleInputPanel',

    initComponent: function () {
        let me = this;

        /* TODO Node selector should be factored out in its own component */
        let update_nodefield, update_node_selection;

        let sm = Ext.create('Ext.selection.CheckboxModel', {
            mode: 'SIMPLE',
            listeners: {
                selectionchange: function (model, selected) {
                    update_nodefield(selected);
                },
            },
        });

        let store = Ext.create('Ext.data.Store', {
            fields: ['node', 'mem', 'cpu', 'priority'],
            data: PVE.data.ResourceStore.getNodes(), // use already cached data to avoid an API call
            proxy: {
                type: 'memory',
                reader: { type: 'json' },
            },
            sorters: [
                {
                    property: 'node',
                    direction: 'ASC',
                },
            ],
        });

        var nodegrid = Ext.createWidget('grid', {
            store: store,
            border: true,
            height: 300,
            selModel: sm,
            columns: [
                {
                    header: gettext('Node'),
                    flex: 1,
                    dataIndex: 'node',
                },
                {
                    header: gettext('Memory usage') + ' %',
                    renderer: PVE.Utils.render_mem_usage_percent,
                    sortable: true,
                    width: 150,
                    dataIndex: 'mem',
                },
                {
                    header: gettext('CPU usage'),
                    renderer: Proxmox.Utils.render_cpu,
                    sortable: true,
                    width: 150,
                    dataIndex: 'cpu',
                },
                {
                    header: gettext('Priority'),
                    xtype: 'widgetcolumn',
                    dataIndex: 'priority',
                    sortable: true,
                    stopSelection: true,
                    widget: {
                        xtype: 'proxmoxintegerfield',
                        minValue: 0,
                        maxValue: 1000,
                        isFormField: false,
                        listeners: {
                            change: function (numberfield, value, old_value) {
                                let record = numberfield.getWidgetRecord();
                                record.set('priority', value);
                                update_nodefield(sm.getSelection());
                                record.commit();
                            },
                        },
                    },
                },
            ],
        });

        let nodefield = Ext.create('Ext.form.field.Hidden', {
            name: 'nodes',
            value: '',
            listeners: {
                change: function (field, value) {
                    update_node_selection(value);
                },
            },
            isValid: function () {
                let value = this.getValue();
                return value && value.length !== 0;
            },
        });

        update_node_selection = function (string) {
            sm.deselectAll(true);

            string.split(',').forEach(function (e, idx, array) {
                let [node, priority] = e.split(':');
                store.each(function (record) {
                    if (record.get('node') === node) {
                        sm.select(record, true);
                        record.set('priority', priority);
                        record.commit();
                    }
                });
            });
            nodegrid.reconfigure(store);
        };

        update_nodefield = function (selected) {
            let nodes = selected
                .map(({ data }) => data.node + (data.priority ? `:${data.priority}` : ''))
                .join(',');

            // nodefield change listener calls us again, which results in a
            // endless recursion, suspend the event temporary to avoid this
            nodefield.suspendEvent('change');
            nodefield.setValue(nodes);
            nodefield.resumeEvent('change');
        };

        me.column2 = [
            {
                xtype: 'proxmoxcheckbox',
                name: 'strict',
                fieldLabel: gettext('Strict'),
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext(
                        'Enable if the HA Resources must be restricted to the nodes.',
                    ),
                },
                uncheckedValue: 0,
                defaultValue: 0,
            },
            nodefield,
        ];

        me.columnB = [nodegrid];

        me.callParent();
    },
});
