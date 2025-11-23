Ext.define('PVE.dc.TokenEdit', {
    extend: 'Proxmox.window.Edit',
    alias: ['widget.pveDcTokenEdit'],
    mixins: ['Proxmox.Mixin.CBind'],

    subject: gettext('Token'),
    onlineHelp: 'pveum_tokens',

    isAdd: true,
    isCreate: false,

    method: 'POST',
    url: '/api2/extjs/access/users/',

    defaultFocus: 'field[disabled=false][hidden=false][name=tokenid]',

    items: {
        xtype: 'inputpanel',
        onGetValues: function (values) {
            let me = this;
            let win = me.up('pveDcTokenEdit');
            win.url = '/api2/extjs/access/users/';
            let uid = encodeURIComponent(values.userid);
            let tid = encodeURIComponent(values.tokenid);
            delete values.userid;
            delete values.tokenid;

            win.url += `${uid}/token/${tid}`;
            return values;
        },
        column1: [
            {
                xtype: 'pmxDisplayEditField',
                cbind: {
                    editable: '{isCreate}',
                },
                submitValue: true,
                editConfig: {
                    xtype: 'pmxUserSelector',
                    allowBlank: false,
                },
                name: 'userid',
                value: Proxmox.UserName,
                renderer: Ext.String.htmlEncode,
                fieldLabel: gettext('User'),
            },
            {
                xtype: 'pmxDisplayEditField',
                cbind: {
                    editable: '{isCreate}',
                },
                name: 'tokenid',
                fieldLabel: gettext('Token ID'),
                submitValue: true,
                minLength: 2,
                allowBlank: false,
            },
        ],
        column2: [
            {
                xtype: 'proxmoxcheckbox',
                name: 'privsep',
                checked: true,
                uncheckedValue: 0,
                fieldLabel: gettext('Privilege Separation'),
            },
            {
                xtype: 'pmxExpireDate',
                name: 'expire',
            },
        ],
        columnB: [
            {
                xtype: 'textfield',
                name: 'comment',
                fieldLabel: gettext('Comment'),
            },
        ],
    },

    initComponent: function () {
        let me = this;

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    me.setValues(response.result.data);
                },
            });
        }
    },
    apiCallDone: function (success, response, options) {
        let res = response.result.data;
        if (!success || !res.value) {
            return;
        }

        Ext.create('PVE.dc.TokenShow', {
            autoShow: true,
            tokenid: res['full-tokenid'],
            secret: res.value,
        });
    },
});

Ext.define('PVE.dc.TokenShow', {
    extend: 'Ext.window.Window',
    alias: ['widget.pveTokenShow'],
    mixins: ['Proxmox.Mixin.CBind'],

    width: 600,
    modal: true,
    resizable: false,
    title: gettext('Token Secret'),

    items: [
        {
            xtype: 'container',
            layout: 'form',
            bodyPadding: 10,
            border: false,
            fieldDefaults: {
                labelWidth: 100,
                anchor: '100%',
            },
            padding: '0 10 10 10',
            items: [
                {
                    xtype: 'textfield',
                    fieldLabel: gettext('Token ID'),
                    cbind: {
                        value: '{tokenid}',
                    },
                    editable: false,
                },
                {
                    xtype: 'textfield',
                    fieldLabel: gettext('Secret'),
                    inputId: 'token-secret-value',
                    cbind: {
                        value: '{secret}',
                    },
                    editable: false,
                },
            ],
        },
        {
            xtype: 'component',
            border: false,
            padding: '10 10 10 10',
            userCls: 'pmx-hint',
            html: gettext('Please record the API token secret - it will only be displayed now'),
        },
    ],
    buttons: [
        {
            handler: function (b) {
                document.getElementById('token-secret-value').select();
                document.execCommand('copy');
            },
            text: gettext('Copy Secret Value'),
            iconCls: 'fa fa-clipboard',
        },
    ],
});
