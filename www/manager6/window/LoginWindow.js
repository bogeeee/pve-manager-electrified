/*global u2f*/
Ext.define('PVE.window.LoginWindow', {
    extend: 'Ext.window.Window',

    viewModel: {
        data: {
            openid: false,
        },
        formulas: {
            button_text: function (get) {
                if (get('openid') === true) {
                    return gettext('Login (OpenID redirect)');
                } else {
                    return gettext('Login');
                }
            },
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        init: async function () {
            if (Proxmox.ConsentText) {
                let oidc_auth_redirect = Proxmox.Utils.getOpenIDRedirectionAuthorization();
                if (oidc_auth_redirect === undefined) {
                    Ext.create('Proxmox.window.ConsentModal', {
                        autoShow: true,
                        consent: Proxmox.Markdown.parse(
                            Proxmox.Utils.base64ToUtf8(Proxmox.ConsentText),
                        ),
                    });
                }
            }
        },

        onLogon: async function () {
            var me = this;

            var form = this.lookupReference('loginForm');
            var unField = this.lookupReference('usernameField');
            var saveunField = this.lookupReference('saveunField');
            var view = this.getView();

            if (!form.isValid()) {
                return;
            }

            let creds = form.getValues();

            if (this.getViewModel().data.openid === true) {
                const redirectURL = location.origin;
                Proxmox.Utils.API2Request({
                    url: '/api2/extjs/access/openid/auth-url',
                    params: {
                        realm: creds.realm,
                        'redirect-url': redirectURL,
                    },
                    method: 'POST',
                    success: function (resp, opts) {
                        window.location = resp.result.data;
                    },
                    failure: function (resp, opts) {
                        Proxmox.Utils.authClear();
                        form.unmask();
                        Ext.MessageBox.alert(
                            gettext('Error'),
                            gettext('OpenID redirect failed.') + `<br>${resp.htmlStatus}`,
                        );
                    },
                });
                return;
            }

            view.el.mask(gettext('Please wait...'), 'x-mask-loading');

            // set or clear username
            var sp = Ext.state.Manager.getProvider();
            if (saveunField.getValue() === true) {
                sp.set(unField.getStateId(), unField.getValue());
            } else {
                sp.clear(unField.getStateId());
            }
            sp.set(saveunField.getStateId(), saveunField.getValue());

            try {
                // Request updated authentication mechanism:
                creds['new-format'] = 1;

                let resp = await Proxmox.Async.api2({
                    url: '/api2/extjs/access/ticket',
                    params: creds,
                    method: 'POST',
                });

                let data = resp.result.data;
                if (data.ticket.startsWith('PVE:!tfa!')) {
                    // Store first factor login information first:
                    data.LoggedOut = true;
                    Proxmox.Utils.setAuthData(data);

                    data = await me.performTFAChallenge(data);

                    // Fill in what we copy over from the 1st factor:
                    data.CSRFPreventionToken = Proxmox.CSRFPreventionToken;
                    data.username = Proxmox.UserName;
                    me.success(data);
                } else if (Ext.isDefined(data.NeedTFA)) {
                    // Store first factor login information first:
                    data.LoggedOut = true;
                    Proxmox.Utils.setAuthData(data);

                    if (Ext.isDefined(data.U2FChallenge)) {
                        me.perform_u2f(data);
                    } else {
                        me.perform_otp();
                    }
                } else {
                    me.success(data);
                }
            } catch (error) {
                me.failure(error);
            }
        },

        /* START NEW TFA CODE (pbs copy) */
        performTFAChallenge: async function (data) {
            let _me = this;

            let userid = data.username;
            let ticket = data.ticket;
            let challenge = JSON.parse(
                decodeURIComponent(ticket.split(':')[1].slice('!tfa!'.length)),
            );

            let resp = await new Promise((resolve, reject) => {
                Ext.create('Proxmox.window.TfaLoginWindow', {
                    userid,
                    ticket,
                    challenge,
                    onResolve: (value) => resolve(value),
                    onReject: reject,
                }).show();
            });

            return resp.result.data;
        },
        /* END NEW TFA CODE (pbs copy) */

        failure: function (resp) {
            var me = this;
            var view = me.getView();
            view.el.unmask();
            var handler = function () {
                var uf = me.lookupReference('usernameField');
                uf.focus(true, true);
            };

            let emsg = gettext('Login failed. Please try again');
            if (resp.status) {
                emsg = Ext.String.format(
                    '{0}<br>{1}<br>{2}',
                    gettext('Login failed:'),
                    resp.htmlStatus,
                    gettext('Please try again'),
                );
            }

            if (resp.failureType === 'connect') {
                emsg = gettext(
                    'Connection failure. Network error or Proxmox VE services not running?',
                );
            }

            Ext.MessageBox.alert(gettext('Error'), emsg, handler);
        },
        success: function (data) {
            var me = this;
            var view = me.getView();
            var handler = view.handler || Ext.emptyFn;
            handler.call(me, data);
            view.close();
        },

        perform_otp: function () {
            var me = this;
            var win = Ext.create('PVE.window.TFALoginWindow', {
                onLogin: function (value) {
                    me.finish_tfa(value);
                },
                onCancel: function () {
                    Proxmox.LoggedOut = false;
                    Proxmox.Utils.authClear();
                    me.getView().show();
                },
            });
            win.show();
        },

        perform_u2f: function (data) {
            var me = this;
            // Show the message:
            var msg = Ext.Msg.show({
                title: 'U2F: ' + gettext('Verification'),
                message: gettext('Please press the button on your U2F Device'),
                buttons: [],
            });
            var chlg = data.U2FChallenge;
            var key = {
                version: chlg.version,
                keyHandle: chlg.keyHandle,
            };
            u2f.sign(chlg.appId, chlg.challenge, [key], function (res) {
                msg.close();
                if (res.errorCode) {
                    Proxmox.Utils.authClear();
                    Ext.Msg.alert(gettext('Error'), PVE.Utils.render_u2f_error(res.errorCode));
                    return;
                }
                delete res.errorCode;
                me.finish_tfa(JSON.stringify(res));
            });
        },
        finish_tfa: function (res) {
            var me = this;
            var view = me.getView();
            view.el.mask(gettext('Please wait...'), 'x-mask-loading');
            Proxmox.Utils.API2Request({
                url: '/api2/extjs/access/tfa',
                params: {
                    response: res,
                },
                method: 'POST',
                timeout: 5000, // it'll delay both success & failure
                success: function (resp, opts) {
                    view.el.unmask();
                    // Fill in what we copy over from the 1st factor:
                    var data = resp.result.data;
                    data.CSRFPreventionToken = Proxmox.CSRFPreventionToken;
                    data.username = Proxmox.UserName;
                    // Finish logging in:
                    me.success(data);
                },
                failure: function (resp, opts) {
                    Proxmox.Utils.authClear();
                    me.failure(resp);
                },
            });
        },

        control: {
            'field[name=username]': {
                specialkey: function (f, e) {
                    if (e.getKey() === e.ENTER) {
                        let pf = this.lookupReference('passwordField');
                        if (!pf.getValue()) {
                            pf.focus(false);
                        }
                    }
                },
            },
            'field[name=lang]': {
                change: function (f, value) {
                    var dt = Ext.Date.add(new Date(), Ext.Date.YEAR, 10);
                    Ext.util.Cookies.set('PVELangCookie', value, dt);
                    this.getView().mask(gettext('Please wait...'), 'x-mask-loading');
                    window.location.reload();
                },
            },
            'field[name=realm]': {
                change: function (f, value) {
                    let record = f.store.getById(value);
                    if (record === undefined) {
                        return;
                    }
                    let data = record.data;
                    this.getViewModel().set('openid', data.type === 'openid');
                },
            },
            'button[reference=loginButton]': {
                click: 'onLogon',
            },
            '#': {
                show: function () {
                    var me = this;

                    var sp = Ext.state.Manager.getProvider();
                    var checkboxField = this.lookupReference('saveunField');
                    var unField = this.lookupReference('usernameField');

                    var checked = sp.get(checkboxField.getStateId());
                    checkboxField.setValue(checked);

                    if (checked === true) {
                        let username = sp.get(unField.getStateId());
                        unField.setValue(username);
                        let pwField = this.lookupReference('passwordField');
                        pwField.focus();
                    }

                    let auth = Proxmox.Utils.getOpenIDRedirectionAuthorization();
                    if (auth !== undefined) {
                        Proxmox.Utils.authClear();

                        let loginForm = this.lookupReference('loginForm');
                        loginForm.mask(gettext('OpenID login - please wait...'), 'x-mask-loading');

                        const redirectURL = location.origin;

                        Proxmox.Utils.API2Request({
                            url: '/api2/extjs/access/openid/login',
                            params: {
                                state: auth.state,
                                code: auth.code,
                                'redirect-url': redirectURL,
                            },
                            method: 'POST',
                            failure: function (response) {
                                loginForm.unmask();
                                let error = response.htmlStatus;
                                Ext.MessageBox.alert(
                                    gettext('Error'),
                                    gettext('OpenID login failed, please try again') +
                                        `<br>${error}`,
                                    () => {
                                        window.location = redirectURL;
                                    },
                                );
                            },
                            success: function (response, options) {
                                loginForm.unmask();
                                let data = response.result.data;
                                history.replaceState(null, '', redirectURL);
                                me.success(data);
                            },
                        });
                    }
                },
            },
        },
    },

    width: 400,
    modal: true,
    border: false,
    draggable: true,
    closable: false,
    resizable: false,
    layout: 'auto',

    title: gettext('Proxmox VE Login'),

    defaultFocus: 'usernameField',
    defaultButton: 'loginButton',

    items: [
        {
            xtype: 'form',
            layout: 'form',
            url: '/api2/extjs/access/ticket',
            reference: 'loginForm',

            fieldDefaults: {
                labelAlign: 'right',
                allowBlank: false,
            },

            items: [
                {
                    xtype: 'textfield',
                    fieldLabel: gettext('User name'),
                    name: 'username',
                    itemId: 'usernameField',
                    reference: 'usernameField',
                    stateId: 'login-username',
                    inputAttrTpl: 'autocomplete=username',
                    bind: {
                        visible: '{!openid}',
                        disabled: '{openid}',
                    },
                },
                {
                    xtype: 'textfield',
                    inputType: 'password',
                    fieldLabel: gettext('Password'),
                    name: 'password',
                    reference: 'passwordField',
                    inputAttrTpl: 'autocomplete=current-password',
                    bind: {
                        visible: '{!openid}',
                        disabled: '{openid}',
                    },
                },
                {
                    xtype: 'pmxRealmComboBox',
                    name: 'realm',
                },
                {
                    xtype: 'proxmoxLanguageSelector',
                    fieldLabel: gettext('Language'),
                    value: PVE.Utils.getUiLanguage(),
                    name: 'lang',
                    reference: 'langField',
                    submitValue: false,
                },
            ],
            buttons: [
                {
                    xtype: 'checkbox',
                    fieldLabel: gettext('Save User name'),
                    name: 'saveusername',
                    reference: 'saveunField',
                    stateId: 'login-saveusername',
                    labelWidth: 250,
                    labelAlign: 'right',
                    submitValue: false,
                    bind: {
                        visible: '{!openid}',
                    },
                },
                {
                    bind: {
                        text: '{button_text}',
                    },
                    reference: 'loginButton',
                },
            ],
        },
    ],
});
