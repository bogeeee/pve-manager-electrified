Ext.define('PVE.dc.UserView', {
    extend: 'Ext.grid.GridPanel',

    alias: ['widget.pveUserView'],

    onlineHelp: 'pveum_users',

    stateful: true,
    stateId: 'grid-users',

    initComponent: function () {
        var me = this;

        var caps = Ext.state.Manager.get('GuiCap');

        var store = new Ext.data.Store({
            id: 'users',
            model: 'pmx-users',
            sorters: {
                property: 'userid',
                direction: 'ASC',
            },
        });
        let reload = () => store.load();

        let sm = Ext.create('Ext.selection.RowModel', {});

        let remove_btn = Ext.create('Proxmox.button.StdRemoveButton', {
            selModel: sm,
            baseurl: '/access/users/',
            dangerous: true,
            enableFn: (rec) => caps.access['User.Modify'] && rec.data.userid !== 'root@pam',
            callback: () => reload(),
        });
        let run_editor = function () {
            var rec = sm.getSelection()[0];
            if (!rec || !caps.access['User.Modify']) {
                return;
            }
            Ext.create('PVE.dc.UserEdit', {
                userid: rec.data.userid,
                autoShow: true,
                listeners: {
                    destroy: () => reload(),
                },
            });
        };
        let edit_btn = new Proxmox.button.Button({
            text: gettext('Edit'),
            disabled: true,
            enableFn: function (rec) {
                return !!caps.access['User.Modify'];
            },
            selModel: sm,
            handler: run_editor,
        });
        let pwchange_btn = new Proxmox.button.Button({
            text: gettext('Password'),
            disabled: true,
            selModel: sm,
            enableFn: function (record) {
                let type = record.data['realm-type'];
                if (type) {
                    if (PVE.Utils.authSchema[type]) {
                        return !!PVE.Utils.authSchema[type].pwchange;
                    }
                }
                return false;
            },
            handler: function (btn, event, rec) {
                let hintHtml;
                if (rec.data['realm-type'] === 'pam') {
                    hintHtml = gettext(
                        'For the PAM realm, this applies only to the connected node.',
                    );
                }

                Ext.create('Proxmox.window.PasswordEdit', {
                    userid: rec.data.userid,
                    confirmCurrentPassword: Proxmox.UserName !== 'root@pam',
                    autoShow: true,
                    hintHtml,
                    minLength: 8,
                    listeners: {
                        destroy: () => reload(),
                    },
                });
            },
        });

        var perm_btn = new Proxmox.button.Button({
            text: gettext('Permissions'),
            disabled: true,
            selModel: sm,
            handler: function (btn, event, rec) {
                Ext.create('PVE.dc.PermissionView', {
                    userid: rec.data.userid,
                    autoShow: true,
                    listeners: {
                        destroy: () => reload(),
                    },
                });
            },
        });

        let unlock_btn = new Proxmox.button.Button({
            text: gettext('Unlock TFA'),
            disabled: true,
            selModel: sm,
            enableFn: (rec) =>
                !!(
                    caps.access['User.Modify'] &&
                    (rec.data['totp-locked'] || rec.data['tfa-locked-until'])
                ),
            handler: function (btn, event, rec) {
                Ext.Msg.confirm(
                    Ext.String.format(
                        gettext('Unlock TFA authentication for {0}'),
                        rec.data.userid,
                    ),
                    gettext(
                        "Locked 2nd factors can happen if the user's password was leaked. Are you sure you want to unlock the user?",
                    ),
                    function (btn_response) {
                        if (btn_response === 'yes') {
                            Proxmox.Utils.API2Request({
                                url: `/access/users/${rec.data.userid}/unlock-tfa`,
                                waitMsgTarget: me,
                                method: 'PUT',
                                failure: function (response, options) {
                                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                                },
                                success: function (response, options) {
                                    reload();
                                },
                            });
                        }
                    },
                );
            },
        });

        Ext.apply(me, {
            store: store,
            selModel: sm,
            tbar: [
                {
                    text: gettext('Add'),
                    disabled: !caps.access['User.Modify'],
                    handler: function () {
                        Ext.create('PVE.dc.UserEdit', {
                            autoShow: true,
                            listeners: {
                                destroy: () => reload(),
                            },
                        });
                    },
                },
                '-',
                edit_btn,
                remove_btn,
                '-',
                pwchange_btn,
                '-',
                perm_btn,
                '-',
                unlock_btn,
            ],
            viewConfig: {
                trackOver: false,
            },
            columns: [
                {
                    header: gettext('User name'),
                    width: 200,
                    sortable: true,
                    renderer: Proxmox.Utils.render_username,
                    dataIndex: 'userid',
                },
                {
                    header: gettext('Realm'),
                    width: 100,
                    sortable: true,
                    renderer: Proxmox.Utils.render_realm,
                    dataIndex: 'userid',
                },
                {
                    header: gettext('Enabled'),
                    width: 80,
                    sortable: true,
                    renderer: Proxmox.Utils.format_boolean,
                    dataIndex: 'enable',
                },
                {
                    header: gettext('Expire'),
                    width: 80,
                    sortable: true,
                    renderer: Proxmox.Utils.format_expire,
                    dataIndex: 'expire',
                },
                {
                    header: gettext('Name'),
                    width: 150,
                    sortable: true,
                    renderer: PVE.Utils.render_full_name,
                    dataIndex: 'firstname',
                },
                {
                    header: 'TFA',
                    width: 120,
                    sortable: true,
                    renderer: function (v, metaData, record) {
                        let tfa_type = PVE.Parser.parseTfaType(v);
                        if (tfa_type === undefined) {
                            return Proxmox.Utils.noText;
                        }

                        if (tfa_type !== 1) {
                            return tfa_type;
                        }

                        let locked_until = record.data['tfa-locked-until'];
                        if (locked_until !== undefined) {
                            let now = new Date().getTime() / 1000;
                            if (locked_until > now) {
                                return gettext('Locked');
                            }
                        }

                        if (record.data['totp-locked']) {
                            return gettext('TOTP Locked');
                        }

                        return Proxmox.Utils.yesText;
                    },
                    dataIndex: 'keys',
                },
                {
                    header: gettext('Groups'),
                    dataIndex: 'groups',
                    renderer: Ext.htmlEncode,
                    flex: 2,
                },
                {
                    header: gettext('Comment'),
                    sortable: false,
                    renderer: Ext.String.htmlEncode,
                    dataIndex: 'comment',
                    flex: 3,
                },
            ],
            listeners: {
                activate: reload,
                itemdblclick: run_editor,
            },
        });

        me.callParent();

        Proxmox.Utils.monStoreErrors(me, store);
    },
});
