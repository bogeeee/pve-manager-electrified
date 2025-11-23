Ext.define('PVE.FirewallLograteInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveFirewallLograteInputPanel',

    viewModel: {},

    items: [
        {
            xtype: 'proxmoxcheckbox',
            name: 'enable',
            reference: 'enable',
            fieldLabel: gettext('Enable'),
            value: true,
        },
        {
            layout: 'hbox',
            border: false,
            items: [
                {
                    xtype: 'numberfield',
                    name: 'rate',
                    fieldLabel: gettext('Log rate limit'),
                    minValue: 1,
                    maxValue: 99,
                    allowBlank: false,
                    flex: 2,
                    value: 1,
                },
                {
                    xtype: 'box',
                    html: '<div style="margin: auto; padding: 2.5px;"><b>/</b></div>',
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'unit',
                    comboItems: [
                        ['second', 'second'],
                        ['minute', 'minute'],
                        ['hour', 'hour'],
                        ['day', 'day'],
                    ],
                    allowBlank: false,
                    flex: 1,
                    value: 'second',
                },
            ],
        },
        {
            xtype: 'numberfield',
            name: 'burst',
            fieldLabel: gettext('Log burst limit'),
            minValue: 1,
            maxValue: 99,
            value: 5,
        },
    ],

    onGetValues: function (values) {
        let _me = this;

        let cfg = {
            enable: values.enable !== undefined ? 1 : 0,
            rate: values.rate + '/' + values.unit,
            burst: values.burst,
        };
        let properties = PVE.Parser.printPropertyString(cfg, undefined);
        if (properties === '') {
            return { delete: 'log_ratelimit' };
        }
        return { log_ratelimit: properties };
    },

    setValues: function (values) {
        let me = this;

        let properties = {};
        if (values.log_ratelimit !== undefined) {
            properties = PVE.Parser.parsePropertyString(values.log_ratelimit, 'enable');
            if (properties.rate) {
                let matches = properties.rate.match(/^(\d+)\/(second|minute|hour|day)$/);
                if (matches) {
                    properties.rate = matches[1];
                    properties.unit = matches[2];
                }
            }
        }
        me.callParent([properties]);
    },
});

Ext.define('PVE.FirewallLograteEdit', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveFirewallLograteEdit',

    subject: gettext('Log rate limit'),

    items: [
        {
            xtype: 'pveFirewallLograteInputPanel',
        },
    ],
    autoLoad: true,
});
