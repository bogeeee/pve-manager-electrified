Ext.define('PVE.form.CRSOptions', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveCRSOptions',

    width: 450,
    subject: gettext('Cluster Resource Scheduling'),
    url: '/api2/extjs/cluster/options',
    onlineHelp: 'ha_manager_crs',

    fieldDefaults: {
        labelWidth: 150,
    },

    setValues: function (values) {
        Ext.Array.each(this.query('inputpanel'), (panel) => {
            panel.setValues(values.crs);
        });
    },

    viewModel: {
        data: {
            crsMode: '__default__',
            autoRebalancing: 0,
        },
        formulas: {
            canUseAutoRebalancing: (get) =>
                get('crsMode') === 'static' || get('crsMode') === 'dynamic',
            autoRebalancingDisabled: (get) =>
                !get('autoRebalancing') || !get('canUseAutoRebalancing'),
        },
    },

    items: [
        {
            xtype: 'inputpanel',
            onGetValues: function (values) {
                let crs = values ? PVE.Parser.printPropertyString(values) : '';
                if (crs === '') {
                    return { delete: 'crs' };
                }
                return { crs };
            },
            items: [
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'ha',
                    fieldLabel: gettext('Scheduling Mode'),
                    deleteEmpty: false,
                    comboItems: [
                        ['__default__', Proxmox.Utils.defaultText + ' (basic)'],
                        ['basic', gettext('Basic (Resource Count)')],
                        ['static', gettext('Static Load')],
                        ['dynamic', gettext('Dynamic Load')],
                    ],
                    bind: {
                        value: '{crsMode}',
                    },
                },
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'ha-rebalance-on-start',
                    fieldLabel: gettext('Rebalance on Start'),
                    boxLabel: gettext(
                        'Use CRS to select the least loaded node when starting an HA resource',
                    ),
                    value: 0,
                },
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'ha-auto-rebalance',
                    fieldLabel: gettext('Automatic Rebalance'),
                    boxLabel: gettext('Automatically rebalance HA resources'),
                    bind: {
                        value: '{autoRebalancing}',
                        disabled: '{!canUseAutoRebalancing}',
                    },
                },
                {
                    xtype: 'numberfield',
                    name: 'ha-auto-rebalance-threshold',
                    fieldLabel: gettext('Imbalance Threshold (%)'),
                    emptyText: Proxmox.Utils.defaultText + ' (30)',
                    minValue: 0,
                    maxValue: 100,
                    step: 1,
                    bind: {
                        disabled: '{autoRebalancingDisabled}',
                    },
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'ha-auto-rebalance-method',
                    fieldLabel: gettext('Rebalancing Method'),
                    deleteEmpty: false,
                    value: '__default__',
                    comboItems: [
                        ['__default__', Proxmox.Utils.defaultText + ' (bruteforce)'],
                        ['bruteforce', 'Bruteforce'],
                        ['topsis', 'TOPSIS'],
                    ],
                    defaultValue: '__default__',
                    bind: {
                        disabled: '{autoRebalancingDisabled}',
                    },
                },
                {
                    xtype: 'numberfield',
                    name: 'ha-auto-rebalance-hold-duration',
                    fieldLabel: gettext('Hold Duration'),
                    emptyText: Proxmox.Utils.defaultText + ' (3)',
                    minValue: 0,
                    step: 1,
                    bind: {
                        disabled: '{autoRebalancingDisabled}',
                    },
                },
                {
                    xtype: 'numberfield',
                    name: 'ha-auto-rebalance-margin',
                    fieldLabel: gettext('Minimum Imbalance Improvement (%)'),
                    emptyText: Proxmox.Utils.defaultText + ' (10)',
                    minValue: 0,
                    maxValue: 100,
                    step: 1,
                    bind: {
                        disabled: '{autoRebalancingDisabled}',
                    },
                },
            ],
        },
    ],
});
