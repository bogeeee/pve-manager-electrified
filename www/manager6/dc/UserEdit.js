Ext.define('PVE.dc.UserEdit', {
    extend: 'Proxmox.window.Edit',
    alias: ['widget.pveDcUserEdit'],

    isAdd: true,

    initComponent: function () {
        let me = this;

        me.isCreate = !me.userid;

        let url = '/api2/extjs/access/users';
        let method = 'POST';
        if (!me.isCreate) {
            url += '/' + encodeURIComponent(me.userid);
            method = 'PUT';
        }

        let verifypw, pwfield;
        let validate_pw = function () {
            if (verifypw.getValue() !== pwfield.getValue()) {
                return gettext('Passwords do not match');
            }
            return true;
        };
        verifypw = Ext.createWidget('textfield', {
            inputType: 'password',
            fieldLabel: gettext('Confirm password'),
            name: 'verifypassword',
            submitValue: false,
            disabled: true,
            hidden: true,
            validator: validate_pw,
        });

        pwfield = Ext.createWidget('textfield', {
            inputType: 'password',
            fieldLabel: gettext('Password'),
            minLength: 8,
            name: 'password',
            disabled: true,
            hidden: true,
            validator: validate_pw,
        });

        let column1 = [
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'userid',
                fieldLabel: gettext('User name'),
                value: me.userid,
                renderer: Ext.String.htmlEncode,
                allowBlank: false,
                submitValue: !!me.isCreate,
            },
            pwfield,
            verifypw,
            {
                xtype: 'pveGroupSelector',
                name: 'groups',
                multiSelect: true,
                allowBlank: true,
                fieldLabel: gettext('Group'),
            },
            {
                xtype: 'pmxExpireDate',
                name: 'expire',
            },
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Enabled'),
                name: 'enable',
                uncheckedValue: 0,
                defaultValue: 1,
                checked: true,
            },
        ];

        let column2 = [
            {
                xtype: 'textfield',
                name: 'firstname',
                fieldLabel: gettext('First Name'),
            },
            {
                xtype: 'textfield',
                name: 'lastname',
                fieldLabel: gettext('Last Name'),
            },
            {
                xtype: 'textfield',
                name: 'email',
                fieldLabel: gettext('E-Mail'),
                vtype: 'proxmoxMail',
            },
        ];

        if (me.isCreate) {
            column1.splice(1, 0, {
                xtype: 'pmxRealmComboBox',
                name: 'realm',
                fieldLabel: gettext('Realm'),
                allowBlank: false,
                matchFieldWidth: false,
                listConfig: { width: 300 },
                listeners: {
                    change: function (combo, realm) {
                        me.realm = realm;
                        pwfield.setVisible(realm === 'pve');
                        pwfield.setDisabled(realm !== 'pve');
                        verifypw.setVisible(realm === 'pve');
                        verifypw.setDisabled(realm !== 'pve');
                    },
                },
                submitValue: false,
            });
        }

        var ipanel = Ext.create('Proxmox.panel.InputPanel', {
            column1: column1,
            column2: column2,
            columnB: [
                {
                    xtype: 'textfield',
                    name: 'comment',
                    fieldLabel: gettext('Comment'),
                },
            ],
            advancedItems: [
                {
                    xtype: 'textfield',
                    name: 'keys',
                    fieldLabel: gettext('Key IDs'),
                },
            ],
            onGetValues: function (values) {
                if (me.realm) {
                    values.userid = values.userid + '@' + me.realm;
                }
                if (!values.password) {
                    delete values.password;
                }
                return values;
            },
        });

        Ext.applyIf(me, {
            subject: gettext('User'),
            url: url,
            method: method,
            fieldDefaults: {
                labelWidth: 110, // some translation are quite long (e.g., Spanish)
            },
            items: [ipanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    var data = response.result.data;
                    me.setValues(data);
                    if (data.keys) {
                        if (
                            data.keys === 'x' ||
                            data.keys === 'x!oath' ||
                            data.keys === 'x!u2f' ||
                            data.keys === 'x!yubico'
                        ) {
                            me.down('[name="keys"]').setDisabled(1);
                        }
                    }
                },
            });
        }
    },
});
