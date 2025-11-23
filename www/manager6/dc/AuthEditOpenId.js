Ext.define('PVE.panel.OpenIDInputPanel', {
    extend: 'PVE.panel.AuthBase',
    xtype: 'pveAuthOpenIDPanel',
    mixins: ['Proxmox.Mixin.CBind'],

    onGetValues: function (values) {
        let me = this;

        if (!values.verify) {
            if (!me.isCreate) {
                Proxmox.Utils.assemble_field_data(values, { delete: 'verify' });
            }
            delete values.verify;
        }

        return me.callParent([values]);
    },

    columnT: [
        {
            xtype: 'textfield',
            name: 'issuer-url',
            fieldLabel: gettext('Issuer URL'),
            allowBlank: false,
        },
    ],

    column1: [
        {
            xtype: 'proxmoxtextfield',
            fieldLabel: gettext('Client ID'),
            name: 'client-id',
            allowBlank: false,
        },
        {
            xtype: 'proxmoxtextfield',
            fieldLabel: gettext('Client Key'),
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
            name: 'client-key',
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'scopes',
            fieldLabel: gettext('Scopes'),
            emptyText: `${Proxmox.Utils.defaultText} (email profile)`,
            submitEmpty: false,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
    ],

    column2: [
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Autocreate Users'),
            name: 'autocreate',
            value: 0,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'pmxDisplayEditField',
            name: 'username-claim',
            fieldLabel: gettext('Username Claim'),
            editConfig: {
                xtype: 'proxmoxKVComboBox',
                editable: true,
                comboItems: [
                    ['__default__', Proxmox.Utils.defaultText],
                    ['subject', 'subject'],
                    ['username', 'username'],
                    ['email', 'email'],
                ],
            },
            cbind: {
                value: (get) => (get('isCreate') ? '__default__' : Proxmox.Utils.defaultText),
                deleteEmpty: '{!isCreate}',
                editable: '{isCreate}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Autocreate Groups'),
            name: 'groups-autocreate',
            value: 0,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'groups-claim',
            fieldLabel: gettext('Groups Claim'),
            emptyText: `${Proxmox.Utils.defaultText} ${gettext('(none)')}`,
            submitEmpty: false,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Overwrite Groups'),
            name: 'groups-overwrite',
            value: 0,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'proxmoxKVComboBox',
            name: 'prompt',
            fieldLabel: gettext('Prompt'),
            editable: true,
            emptyText: gettext('Auth-Provider Default'),
            comboItems: [
                ['__default__', gettext('Auth-Provider Default')],
                ['none', 'none'],
                ['login', 'login'],
                ['consent', 'consent'],
                ['select_account', 'select_account'],
            ],
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
    ],

    advancedColumnB: [
        {
            xtype: 'proxmoxtextfield',
            name: 'acr-values',
            fieldLabel: gettext('ACR Values'),
            submitEmpty: false,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Query userinfo endpoint'),
            name: 'query-userinfo',
            checked: true,
            uncheckedValue: 0,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
    ],

    initComponent: function () {
        let me = this;

        if (me.type !== 'openid') {
            throw 'invalid type';
        }

        me.callParent();
    },
});
