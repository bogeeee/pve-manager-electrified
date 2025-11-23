Ext.define('PVE.panel.ADInputPanel', {
    extend: 'PVE.panel.AuthBase',
    xtype: 'pveAuthADPanel',

    initComponent: function () {
        let me = this;

        if (me.type !== 'ad') {
            throw 'invalid type';
        }

        me.column1 = [
            {
                xtype: 'textfield',
                name: 'domain',
                fieldLabel: gettext('Domain'),
                emptyText: 'company.net',
                allowBlank: false,
            },
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Case-Sensitive'),
                name: 'case-sensitive',
                uncheckedValue: 0,
                checked: true,
            },
        ];

        me.column2 = [
            {
                xtype: 'textfield',
                fieldLabel: gettext('Server'),
                name: 'server1',
                allowBlank: false,
            },
            {
                xtype: 'proxmoxtextfield',
                fieldLabel: gettext('Fallback Server'),
                deleteEmpty: !me.isCreate,
                name: 'server2',
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'port',
                fieldLabel: gettext('Port'),
                minValue: 1,
                maxValue: 65535,
                emptyText: gettext('Default'),
                submitEmptyText: false,
            },
            {
                xtype: 'proxmoxKVComboBox',
                name: 'mode',
                fieldLabel: gettext('Mode'),
                editable: false,
                comboItems: [
                    ['__default__', Proxmox.Utils.defaultText + ' (LDAP)'],
                    ['ldap', 'LDAP'],
                    ['ldap+starttls', 'STARTTLS'],
                    ['ldaps', 'LDAPS'],
                ],
                value: '__default__',
                deleteEmpty: !me.isCreate,
                listeners: {
                    change: function (field, newValue) {
                        let verifyCheckbox = field.nextSibling('proxmoxcheckbox[name=verify]');
                        if (newValue === 'ldap' || newValue === '__default__') {
                            verifyCheckbox.disable();
                            verifyCheckbox.setValue(0);
                        } else {
                            verifyCheckbox.enable();
                        }
                    },
                },
            },
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Verify Certificate'),
                name: 'verify',
                uncheckedValue: 0,
                disabled: true,
                checked: false,
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext('Verify TLS certificate of the server'),
                },
            },
        ];

        me.advancedItems = [
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Check connection'),
                name: 'check-connection',
                uncheckedValue: 0,
                checked: true,
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext(
                        'Verify connection parameters and bind credentials on save',
                    ),
                },
            },
        ];

        me.callParent();
    },
    onGetValues: function (values) {
        let me = this;

        if (!values.verify) {
            if (!me.isCreate) {
                Proxmox.Utils.assemble_field_data(values, { delete: 'verify' });
            }
            delete values.verify;
        }

        if (!me.isCreate) {
            // Delete old `secure` parameter. It has been deprecated in favor to the
            // `mode` parameter. Migration happens automatically in `onSetValues`.
            Proxmox.Utils.assemble_field_data(values, { delete: 'secure' });
        }

        return me.callParent([values]);
    },

    onSetValues(values) {
        let me = this;

        if (values.secure !== undefined && !values.mode) {
            // If `secure` is set, use it to determine the correct setting for `mode`
            // `secure` is later deleted by `onSetValues` .
            // In case *both* are set, we simply ignore `secure` and use
            // whatever `mode` is set to.
            values.mode = values.secure ? 'ldaps' : 'ldap';
        }

        return me.callParent([values]);
    },
});
