Ext.define('pve-ha-rules', {
    extend: 'Ext.data.Model',
    fields: [
        'rule',
        'type',
        'nodes',
        'digest',
        'errors',
        'disable',
        'comment',
        'affinity',
        'resources',
        {
            name: 'strict',
            type: 'boolean',
        },
    ],
    proxy: {
        type: 'proxmox',
        url: '/api2/json/cluster/ha/rules',
    },
    idProperty: 'rule',
});
Ext.define('pve-ha-rules-memory', {
    extend: 'pve-ha-rules',
    proxy: {
        type: 'memory',
    },
});

Ext.define('PVE.ha.RulesBaseView', {
    extend: 'Ext.grid.GridPanel',
    mixins: ['Proxmox.Mixin.CBind'],

    store: {
        model: 'pve-ha-rules-memory',
        cbind: {}, // empty cbind to ensure mixin iterates into filter array.
        filters: [
            {
                property: 'type',
                cbind: {
                    value: '{ruleType}',
                },
            },
        ],
    },

    initComponent: function () {
        let me = this;

        if (!me.ruleType) {
            throw 'no rule type given';
        }

        let reloadStore = () => me.up('pveHARulesView').store.load();

        let sm = Ext.create('Ext.selection.RowModel', {});

        let createRuleEditWindow = (ruleId) => {
            if (!me.inputPanel) {
                throw `no editor registered for ha rule type: ${me.ruleType}`;
            }

            Ext.create('PVE.ha.RuleEdit', {
                panelType: `PVE.ha.rules.${me.inputPanel}`,
                panelName: me.ruleTitle,
                ruleType: me.ruleType,
                ruleId: ruleId,
                autoShow: true,
                listeners: {
                    destroy: reloadStore,
                },
            });
        };

        let runEditor = () => {
            let rec = sm.getSelection()[0];
            if (!rec) {
                return;
            }
            let { rule } = rec.data;
            createRuleEditWindow(rule);
        };

        let childColumns = me.columns || [];

        Ext.apply(me, {
            selModel: sm,
            viewConfig: {
                trackOver: false,
            },
            emptyText: Ext.String.format(gettext('No {0} rules configured.'), me.ruleTitle),
            tbar: [
                {
                    text: gettext('Add'),
                    handler: () => createRuleEditWindow(),
                },
                {
                    xtype: 'proxmoxButton',
                    text: gettext('Edit'),
                    disabled: true,
                    selModel: sm,
                    handler: runEditor,
                },
                {
                    xtype: 'proxmoxStdRemoveButton',
                    selModel: sm,
                    baseurl: '/cluster/ha/rules/',
                    callback: reloadStore,
                },
            ],
            columns: [
                {
                    header: gettext('ID'),
                    dataIndex: 'rule',
                    width: 160,
                    hidden: true,
                    sortable: true,
                },
                {
                    header: gettext('Enabled'),
                    width: 80,
                    dataIndex: 'disable',
                    align: 'center',
                    renderer: (value) => Proxmox.Utils.renderEnabledIcon(!value),
                    sortable: true,
                },
                {
                    header: gettext('State'),
                    xtype: 'actioncolumn',
                    width: 65,
                    align: 'center',
                    dataIndex: 'errors',
                    items: [
                        {
                            handler: (table, rowIndex, colIndex, item, event, { data }) => {
                                if (Object.keys(data.errors ?? {}.length)) {
                                    Ext.create('PVE.ha.RuleErrorsModal', {
                                        autoShow: true,
                                        errors: data.errors,
                                    });
                                }
                            },
                            getTip: (value) =>
                                Object.keys(value ?? {}).length
                                    ? gettext('HA Rule has conflicts and/or errors.')
                                    : gettext('HA Rule is OK.'),
                            getClass: (value) =>
                                Object.keys(value ?? {}).length
                                    ? 'fa fa-exclamation-triangle'
                                    : 'fa fa-check pmx-unclickable',
                        },
                    ],
                },
                ...childColumns,
                {
                    header: gettext('Comment'),
                    flex: 1,
                    renderer: Ext.String.htmlEncode,
                    dataIndex: 'comment',
                },
            ],
            listeners: {
                activate: reloadStore,
                itemdblclick: runEditor,
            },
        });

        me.callParent();
    },
});

Ext.define('PVE.ha.RulesView', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveHARulesView',

    onlineHelp: 'ha_manager_rules',

    layout: {
        type: 'vbox',
        align: 'stretch',
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        init: function (view) {
            view.store = new Ext.data.Store({
                model: 'pve-ha-rules',
                storeId: 'pve-ha-rules',
                autoLoad: true,
            });
            view.store.on('load', this.onStoreLoad, this);
        },

        onStoreLoad: function (store, records, success) {
            let me = this;
            let view = me.getView();

            for (const grid of view.query('grid[ruleType]')) {
                grid.getStore().setRecords(records);
            }
        },
    },

    items: [
        {
            title: gettext('HA Node Affinity Rules'),
            xtype: 'pveHANodeAffinityRulesView',
            flex: 2,
            border: 0,
        },
        {
            xtype: 'splitter',
            collapsible: false,
            performCollapse: false,
        },
        {
            title: gettext('HA Resource Affinity Rules'),
            xtype: 'pveHAResourceAffinityRulesView',
            flex: 3,
            border: 0,
        },
    ],
});
