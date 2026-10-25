Ext.define('PVE.forms.NodePrioritySelector', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.pveNodePrioritySelector',

    mixins: {
        field: 'Ext.form.field.Field',
    },

    allowBlank: true,
    isFormField: true,

    config: {
        useNodePriority: null,
    },

    publishes: ['useNodePriority'],

    viewModel: {
        data: {
            showNodePriority: null,
        },
    },

    store: {
        autoLoad: true,
        fields: ['node', 'cpu', 'mem', 'priority'],
        proxy: {
            type: 'proxmox',
            url: '/api2/json/nodes',
        },
        sorters: [
            {
                property: 'node',
                direction: 'ASC',
            },
        ],
    },

    columns: [
        {
            header: gettext('Node'),
            width: 150,
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
            flex: 1,
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
                    change: function (field, value) {
                        let record = field.getWidgetRecord();
                        record.set('priority', value);
                        record.commit();
                    },
                },
                bind: {
                    hidden: '{!showNodePriority}',
                    disabled: '{!showNodePriority}',
                },
            },
            bind: {
                hidden: '{!showNodePriority}',
                disabled: '{!showNodePriority}',
            },
        },
    ],

    selModel: {
        selType: 'checkboxmodel',
        mode: 'SIMPLE',
    },

    checkChangeEvents: ['selectionchange'],

    listeners: {
        selectionchange: function () {
            // to trigger validity and error checks
            this.checkChange();
        },
    },

    invertCheckboxSelection: function () {
        let me = this;

        let sm = me.getSelectionModel();

        let allNodeModels = sm.getStore().getRange();
        let selectedNodeModels = new Set(sm.getSelection());

        if (!allNodeModels.length || !selectedNodeModels.size) {
            return;
        }

        sm.deselectAll();
        sm.select(allNodeModels.filter((node) => !selectedNodeModels.has(node)));
    },

    applyUseNodePriority: function (newValue) {
        let me = this;

        me.getViewModel().set('showNodePriority', newValue);

        return newValue;
    },

    getSubmitData: function () {
        let me = this;
        let res = {};
        res[me.name] = me.getValue();
        return res;
    },

    getValue: function () {
        let me = this;

        if (me.savedValue !== undefined) {
            return me.savedValue;
        }

        let sm = me.getSelectionModel();
        let selectedNodeModels = sm.getSelection();
        let nodes = selectedNodeModels
            .map(({ data }) => {
                let nodeEntry = data.node;

                if (me.useNodePriority && data.priority) {
                    nodeEntry += `:${data.priority}`;
                }

                return nodeEntry;
            })
            .join(',');

        return nodes;
    },

    setValueSelection: function (value) {
        let me = this;

        let store = me.getStore();
        store.beginUpdate();
        let nodenames = value.length ? value.split(',') : [];
        let nodes = nodenames.map((item) => {
            let [node, priority] = item.split(':');

            let record = store.findRecord('node', node, 0, false, true, true);
            if (record) {
                record.set('priority', priority);
                record.commit();
            } else {
                let addedRecords = store.add({ node, priority });
                record = addedRecords[0];
            }

            return record;
        });
        store.endUpdate();

        let sm = me.getSelectionModel();
        if (nodes.length) {
            sm.select(nodes);
        } else {
            sm.deselectAll();
        }

        me.getErrors();
    },

    setValue: function (value) {
        let me = this;

        let store = me.getStore();
        if (!store.isLoaded()) {
            me.savedValue = value;
            store.on(
                'load',
                function () {
                    me.setValueSelection(value);
                    delete me.savedValue;
                },
                { single: true },
            );
        } else {
            me.setValueSelection(value);
        }

        return me.mixins.field.setValue.call(me, value);
    },

    getErrors: function (value) {
        let me = this;

        if (!me.isDisabled() && me.allowBlank === false && me.getValue().length === 0) {
            me.addBodyCls(['x-form-trigger-wrap-default', 'x-form-trigger-wrap-invalid']);
            return [gettext('No nodes selected')];
        }

        me.removeBodyCls(['x-form-trigger-wrap-default', 'x-form-trigger-wrap-invalid']);

        return [];
    },

    initComponent: function () {
        let me = this;

        me.callParent();
        me.initField();
    },
});
