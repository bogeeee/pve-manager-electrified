Ext.define('PVE.form.CRSOptions', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveCRSOptions',

    width: 450,
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

    viewModel: {},

    items: [
        {
            xtype: 'inputpanel',
            onGetValues: function (values) {
                if (values === undefined || Object.keys(values).length === 0) {
                    return { delete: 'crs' };
                } else {
                    return { crs: PVE.Parser.printPropertyString(values) };
                }
            },
            items: [
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'ha',
                    fieldLabel: gettext('HA Scheduling'),
                    deleteEmpty: false,
                    value: '__default__',
                    comboItems: [
                        ['__default__', Proxmox.Utils.defaultText + ' (basic)'],
                        ['basic', gettext('Basic (Resource Count)')],
                        ['static', gettext('Static Load')],
                        ['dynamic', gettext('Dynamic Load')],
                    ],
                    defaultValue: '__default__',
                },
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'ha-rebalance-on-start',
                    fieldLabel: gettext('Rebalance on Start'),
                    boxLabel: gettext(
                        'Use CRS to select the least loaded node when starting an HA service',
                    ),
                    value: 0,
                },
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'ha-auto-rebalance',
                    fieldLabel: gettext('Automatic Rebalance'),
                    boxLabel: gettext('Automatically rebalance HA resources'),
                    value: 0,
                    reference: 'enableAutoRebalance',
                },
                {
                    xtype: 'numberfield',
                    name: 'ha-auto-rebalance-threshold',
                    fieldLabel: gettext('Imbalance Threshold'),
                    emptyText: '0.3',
                    minValue: 0.0,
                    step: 0.01,
                    bind: {
                        disabled: '{!enableAutoRebalance.checked}',
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
                        disabled: '{!enableAutoRebalance.checked}',
                    },
                },
                {
                    xtype: 'numberfield',
                    name: 'ha-auto-rebalance-hold-duration',
                    fieldLabel: gettext('Hold Duration'),
                    emptyText: '3',
                    minValue: 0,
                    step: 1,
                    bind: {
                        disabled: '{!enableAutoRebalance.checked}',
                    },
                },
                {
                    xtype: 'numberfield',
                    name: 'ha-auto-rebalance-margin',
                    fieldLabel: gettext('Minimum Imbalance Improvement'),
                    emptyText: '0.1',
                    minValue: 0.0,
                    maxValue: 1.0,
                    step: 0.01,
                    bind: {
                        disabled: '{!enableAutoRebalance.checked}',
                    },
                },
            ],
        },
    ],
});
