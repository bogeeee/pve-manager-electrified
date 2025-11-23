Ext.define('PVE.panel.LDAPInputPanel', {
    extend: 'PVE.panel.AuthBase',
    xtype: 'pveAuthLDAPPanel',

    initComponent: function () {
        let me = this;

        if (me.type !== 'ldap') {
            throw 'invalid type';
        }

        me.column1 = [
            {
                xtype: 'textfield',
                name: 'base_dn',
                fieldLabel: gettext('Base Domain Name'),
                emptyText: 'CN=Users,DC=Company,DC=net',
                allowBlank: false,
            },
            {
                xtype: 'textfield',
                name: 'user_attr',
                emptyText: 'uid / sAMAccountName',
                fieldLabel: gettext('User Attribute Name'),
                allowBlank: false,
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

Ext.define('PVE.panel.LDAPSyncInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveAuthLDAPSyncPanel',

    editableAttributes: ['email'],
    editableDefaults: ['scope', 'enable-new'],
    default_opts: {},
    sync_attributes: {},

    // (de)construct the sync-attributes from the list above,
    // not touching all others
    onGetValues: function (values) {
        let me = this;
        me.editableDefaults.forEach((attr) => {
            if (values[attr]) {
                me.default_opts[attr] = values[attr];
                delete values[attr];
            } else {
                delete me.default_opts[attr];
            }
        });
        let vanished_opts = [];
        ['acl', 'entry', 'properties'].forEach((prop) => {
            if (values[`remove-vanished-${prop}`]) {
                vanished_opts.push(prop);
            }
            delete values[`remove-vanished-${prop}`];
        });
        me.default_opts['remove-vanished'] = vanished_opts.join(';');

        values['sync-defaults-options'] = PVE.Parser.printPropertyString(me.default_opts);
        me.editableAttributes.forEach((attr) => {
            if (values[attr]) {
                me.sync_attributes[attr] = values[attr];
                delete values[attr];
            } else {
                delete me.sync_attributes[attr];
            }
        });
        values.sync_attributes = PVE.Parser.printPropertyString(me.sync_attributes);

        PVE.Utils.delete_if_default(values, 'sync-defaults-options');
        PVE.Utils.delete_if_default(values, 'sync_attributes');

        // Force values.delete to be an array
        if (typeof values.delete === 'string') {
            values.delete = values.delete.split(',');
        }

        if (me.isCreate) {
            delete values.delete; // on create we cannot delete values
        }

        return values;
    },

    setValues: function (values) {
        let me = this;
        if (values.sync_attributes) {
            me.sync_attributes = PVE.Parser.parsePropertyString(values.sync_attributes);
            delete values.sync_attributes;
            me.editableAttributes.forEach((attr) => {
                if (me.sync_attributes[attr]) {
                    values[attr] = me.sync_attributes[attr];
                }
            });
        }
        if (values['sync-defaults-options']) {
            me.default_opts = PVE.Parser.parsePropertyString(values['sync-defaults-options']);
            delete values.default_opts;
            me.editableDefaults.forEach((attr) => {
                if (me.default_opts[attr]) {
                    values[attr] = me.default_opts[attr];
                }
            });

            if (me.default_opts['remove-vanished']) {
                let opts = me.default_opts['remove-vanished'].split(';');
                for (const opt of opts) {
                    values[`remove-vanished-${opt}`] = 1;
                }
            }
        }
        return me.callParent([values]);
    },

    column1: [
        {
            xtype: 'proxmoxtextfield',
            name: 'bind_dn',
            deleteEmpty: true,
            emptyText: Proxmox.Utils.noneText,
            fieldLabel: gettext('Bind User'),
        },
        {
            xtype: 'proxmoxtextfield',
            inputType: 'password',
            name: 'password',
            emptyText: gettext('Unchanged'),
            fieldLabel: gettext('Bind Password'),
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'email',
            fieldLabel: gettext('E-Mail attribute'),
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'group_name_attr',
            deleteEmpty: true,
            fieldLabel: gettext('Groupname attr.'),
        },
        {
            xtype: 'displayfield',
            value: gettext('Default Sync Options'),
        },
        {
            xtype: 'proxmoxKVComboBox',
            name: 'scope',
            emptyText: Proxmox.Utils.NoneText,
            fieldLabel: gettext('Scope'),
            value: '__default__',
            deleteEmpty: false,
            comboItems: [
                ['__default__', Proxmox.Utils.NoneText],
                ['users', gettext('Users')],
                ['groups', gettext('Groups')],
                ['both', gettext('Users and Groups')],
            ],
        },
    ],

    column2: [
        {
            xtype: 'proxmoxtextfield',
            name: 'user_classes',
            fieldLabel: gettext('User classes'),
            deleteEmpty: true,
            emptyText: 'inetorgperson, posixaccount, person, user',
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'group_classes',
            fieldLabel: gettext('Group classes'),
            deleteEmpty: true,
            emptyText: 'groupOfNames, group, univentionGroup, ipausergroup',
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'filter',
            fieldLabel: gettext('User Filter'),
            deleteEmpty: true,
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'group_filter',
            fieldLabel: gettext('Group Filter'),
            deleteEmpty: true,
        },
        {
            // fake for spacing
            xtype: 'displayfield',
            value: ' ',
        },
        {
            xtype: 'proxmoxKVComboBox',
            value: '__default__',
            deleteEmpty: false,
            comboItems: [
                [
                    '__default__',
                    Ext.String.format(
                        gettext('{0} ({1})'),
                        Proxmox.Utils.yesText,
                        Proxmox.Utils.defaultText,
                    ),
                ],
                ['1', Proxmox.Utils.yesText],
                ['0', Proxmox.Utils.noText],
            ],
            name: 'enable-new',
            fieldLabel: gettext('Enable new users'),
        },
    ],

    columnB: [
        {
            xtype: 'fieldset',
            title: gettext('Remove Vanished Options'),
            items: [
                {
                    xtype: 'proxmoxcheckbox',
                    fieldLabel: gettext('ACL'),
                    name: 'remove-vanished-acl',
                    boxLabel: gettext('Remove ACLs of vanished users and groups.'),
                },
                {
                    xtype: 'proxmoxcheckbox',
                    fieldLabel: gettext('Entry'),
                    name: 'remove-vanished-entry',
                    boxLabel: gettext('Remove vanished user and group entries.'),
                },
                {
                    xtype: 'proxmoxcheckbox',
                    fieldLabel: gettext('Properties'),
                    name: 'remove-vanished-properties',
                    boxLabel: gettext('Remove vanished properties from synced users.'),
                },
            ],
        },
    ],
});
