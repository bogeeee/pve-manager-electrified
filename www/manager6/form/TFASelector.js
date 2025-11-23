Ext.define('PVE.form.TFASelector', {
    extend: 'Ext.container.Container',
    xtype: 'pveTFASelector',
    mixins: ['Proxmox.Mixin.CBind'],

    deleteEmpty: true,

    viewModel: {
        data: {
            type: '__default__',
            step: null,
            digits: null,
            id: null,
            key: null,
            url: null,
        },

        formulas: {
            isOath: (get) => get('type') === 'oath',
            isYubico: (get) => get('type') === 'yubico',
            tfavalue: {
                get: function (get) {
                    let val = {
                        type: get('type'),
                    };
                    if (get('isOath')) {
                        let step = get('step');
                        let digits = get('digits');
                        if (step) {
                            val.step = step;
                        }
                        if (digits) {
                            val.digits = digits;
                        }
                    } else if (get('isYubico')) {
                        let id = get('id');
                        let key = get('key');
                        let url = get('url');
                        val.id = id;
                        val.key = key;
                        if (url) {
                            val.url = url;
                        }
                    } else if (val.type === '__default__') {
                        return '';
                    }

                    return PVE.Parser.printPropertyString(val);
                },
                set: function (value) {
                    let val = PVE.Parser.parseTfaConfig(value);
                    this.set(val);
                    this.notify();
                    // we need to reset the original values, so that
                    // we can reliably track the state of the form
                    let form = this.getView().up('form');
                    if (form.trackResetOnLoad) {
                        let fields = this.getView().query('field[name!="tfa"]');
                        fields.forEach((field) => field.resetOriginalValue());
                    }
                },
            },
        },
    },

    items: [
        {
            xtype: 'proxmoxtextfield',
            name: 'tfa',
            hidden: true,
            submitValue: true,
            cbind: {
                deleteEmpty: '{deleteEmpty}',
            },
            bind: {
                value: '{tfavalue}',
            },
        },
        {
            xtype: 'proxmoxKVComboBox',
            value: '__default__',
            deleteEmpty: false,
            submitValue: false,
            fieldLabel: gettext('Require TFA'),
            comboItems: [
                ['__default__', Proxmox.Utils.noneText],
                ['oath', 'OATH/TOTP'],
                ['yubico', 'Yubico'],
            ],
            bind: {
                value: '{type}',
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            hidden: true,
            minValue: 10,
            submitValue: false,
            emptyText: Proxmox.Utils.defaultText + ' (30)',
            fieldLabel: gettext('Time Step'),
            bind: {
                value: '{step}',
                hidden: '{!isOath}',
                disabled: '{!isOath}',
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            hidden: true,
            submitValue: false,
            fieldLabel: gettext('Secret Length'),
            minValue: 6,
            maxValue: 8,
            emptyText: Proxmox.Utils.defaultText + ' (6)',
            bind: {
                value: '{digits}',
                hidden: '{!isOath}',
                disabled: '{!isOath}',
            },
        },
        {
            xtype: 'textfield',
            hidden: true,
            submitValue: false,
            allowBlank: false,
            fieldLabel: 'Yubico API Id',
            bind: {
                value: '{id}',
                hidden: '{!isYubico}',
                disabled: '{!isYubico}',
            },
        },
        {
            xtype: 'textfield',
            hidden: true,
            submitValue: false,
            allowBlank: false,
            fieldLabel: 'Yubico API Key',
            bind: {
                value: '{key}',
                hidden: '{!isYubico}',
                disabled: '{!isYubico}',
            },
        },
        {
            xtype: 'textfield',
            hidden: true,
            submitValue: false,
            fieldLabel: 'Yubico URL',
            bind: {
                value: '{url}',
                hidden: '{!isYubico}',
                disabled: '{!isYubico}',
            },
        },
    ],
});
