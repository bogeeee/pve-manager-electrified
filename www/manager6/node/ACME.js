Ext.define('PVE.node.ACMEAccountCreate', {
    extend: 'Proxmox.window.Edit',
    mixins: ['Proxmox.Mixin.CBind'],

    width: 450,
    title: gettext('Register Account'),
    isCreate: true,
    method: 'POST',
    submitText: gettext('Register'),
    url: '/cluster/acme/account',
    showTaskViewer: true,
    defaultExists: false,
    referenceHolder: true,
    onlineHelp: 'sysadmin_certs_acme_account',

    viewModel: {
        data: {
            customDirectory: false,
            eabRequired: false,
        },
        formulas: {
            eabEmptyText: function (get) {
                return get('eabRequired') ? gettext('required') : gettext('optional');
            },
        },
    },

    items: [
        {
            xtype: 'proxmoxtextfield',
            fieldLabel: gettext('Account Name'),
            name: 'name',
            cbind: {
                emptyText: (get) => (get('defaultExists') ? '' : 'default'),
                allowBlank: (get) => !get('defaultExists'),
            },
        },
        {
            xtype: 'textfield',
            name: 'contact',
            vtype: 'email',
            allowBlank: false,
            fieldLabel: gettext('E-Mail'),
        },
        {
            xtype: 'proxmoxComboGrid',
            notFoundIsValid: true,
            isFormField: false,
            allowBlank: false,
            valueField: 'url',
            displayField: 'name',
            fieldLabel: gettext('ACME Directory'),
            store: {
                listeners: {
                    load: function () {
                        this.add({ name: gettext('Custom'), url: '' });
                    },
                },
                autoLoad: true,
                fields: ['name', 'url'],
                idProperty: ['name'],
                proxy: {
                    type: 'proxmox',
                    url: '/api2/json/cluster/acme/directories',
                },
            },
            listConfig: {
                columns: [
                    {
                        header: gettext('Name'),
                        dataIndex: 'name',
                        flex: 1,
                    },
                    {
                        header: gettext('URL'),
                        dataIndex: 'url',
                        flex: 1,
                    },
                ],
            },
            listeners: {
                change: function (combogrid, value) {
                    let me = this;

                    let vm = me.up('window').getViewModel();
                    let dirField = me.up('window').lookupReference('directoryInput');
                    let tosButton = me.up('window').lookupReference('queryTos');

                    let isCustom = combogrid.getSelection().get('name') === gettext('Custom');
                    vm.set('customDirectory', isCustom);

                    dirField.setValue(value);

                    if (!isCustom) {
                        tosButton.click();
                    } else {
                        me.up('window').clearToSFields();
                    }
                },
            },
        },
        {
            xtype: 'fieldcontainer',
            layout: 'hbox',
            fieldLabel: gettext('URL'),
            bind: {
                hidden: '{!customDirectory}',
            },
            items: [
                {
                    xtype: 'proxmoxtextfield',
                    name: 'directory',
                    reference: 'directoryInput',
                    flex: 1,
                    allowBlank: false,
                    listeners: {
                        change: function (textbox, value) {
                            let me = this;
                            me.up('window').clearToSFields();
                        },
                    },
                },
                {
                    xtype: 'proxmoxButton',
                    margin: '0 0 0 5',
                    reference: 'queryTos',
                    text: gettext('Query URL'),
                    listeners: {
                        click: function (button) {
                            let me = this;

                            let w = me.up('window');
                            let vm = w.getViewModel();
                            let disp = w.down('#tos_url_display');
                            let field = w.down('#tos_url');
                            let checkbox = w.down('#tos_checkbox');
                            let value = w.lookupReference('directoryInput').getValue();
                            w.clearToSFields();

                            if (!value) {
                                return;
                            } else {
                                disp.setValue(gettext('Loading'));
                            }

                            Proxmox.Utils.API2Request({
                                url: '/cluster/acme/meta',
                                method: 'GET',
                                params: {
                                    directory: value,
                                },
                                success: function (response, opt) {
                                    if (
                                        response.result.data &&
                                        response.result.data.termsOfService
                                    ) {
                                        field.setValue(response.result.data.termsOfService);
                                        disp.setValue(response.result.data.termsOfService);
                                        checkbox.setHidden(false);
                                    } else {
                                        // Needed to pass input verification and enable register button
                                        // has no influence on the submitted form
                                        checkbox.setValue(true);
                                        disp.setValue('No terms of service agreement required');
                                    }
                                    vm.set(
                                        'eabRequired',
                                        !!(
                                            response.result.data &&
                                            response.result.data.externalAccountRequired
                                        ),
                                    );
                                },
                                failure: function (response, opt) {
                                    disp.setValue(undefined);
                                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                                },
                            });
                        },
                    },
                },
            ],
        },
        {
            xtype: 'displayfield',
            itemId: 'tos_url_display',
            renderer: PVE.Utils.render_optional_url,
            name: 'tos_url_display',
        },
        {
            xtype: 'hidden',
            itemId: 'tos_url',
            name: 'tos_url',
        },
        {
            xtype: 'proxmoxcheckbox',
            itemId: 'tos_checkbox',
            boxLabel: gettext('Accept TOS'),
            submitValue: false,
            validateValue: function (value) {
                if (value && this.checked) {
                    return true;
                }
                return false;
            },
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'eab-kid',
            fieldLabel: gettext('EAB Key ID'),
            bind: {
                hidden: '{!customDirectory}',
                allowBlank: '{!eabRequired}',
                emptyText: '{eabEmptyText}',
            },
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'eab-hmac-key',
            fieldLabel: gettext('EAB Key'),
            bind: {
                hidden: '{!customDirectory}',
                allowBlank: '{!eabRequired}',
                emptyText: '{eabEmptyText}',
            },
        },
    ],

    clearToSFields: function () {
        let me = this;

        let disp = me.down('#tos_url_display');
        let field = me.down('#tos_url');
        let checkbox = me.down('#tos_checkbox');

        disp.setValue('Terms of service not fetched yet');
        field.setValue(undefined);
        checkbox.setValue(undefined);
        checkbox.setHidden(true);
    },
});

Ext.define('PVE.node.ACMEDomainEdit', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveACMEDomainEdit',

    subject: gettext('Domain'),
    isCreate: false,
    width: 450,
    onlineHelp: 'sysadmin_certificate_management',

    items: [
        {
            xtype: 'inputpanel',
            onGetValues: function (values) {
                let me = this;
                let win = me.up('pveACMEDomainEdit');
                let nodeconfig = win.nodeconfig;
                let olddomain = win.domain || {};

                let params = {
                    digest: nodeconfig.digest,
                };

                let configkey = olddomain.configkey;
                let acmeObj = PVE.Parser.parseACME(nodeconfig.acme);

                if (values.type === 'dns') {
                    if (!olddomain.configkey || olddomain.configkey === 'acme') {
                        // look for first free slot
                        for (let i = 0; i < PVE.Utils.acmedomain_count; i++) {
                            if (nodeconfig[`acmedomain${i}`] === undefined) {
                                configkey = `acmedomain${i}`;
                                break;
                            }
                        }
                        if (olddomain.domain) {
                            // we have to remove the domain from the acme domainlist
                            PVE.Utils.remove_domain_from_acme(acmeObj, olddomain.domain);
                            params.acme = PVE.Parser.printACME(acmeObj);
                        }
                    }

                    delete values.type;
                    params[configkey] = PVE.Parser.printPropertyString(values, 'domain');
                } else {
                    if (olddomain.configkey && olddomain.configkey !== 'acme') {
                        // delete the old dns entry
                        params.delete = [olddomain.configkey];
                    }

                    // add new, remove old and make entries unique
                    PVE.Utils.add_domain_to_acme(acmeObj, values.domain);
                    PVE.Utils.remove_domain_from_acme(acmeObj, olddomain.domain);
                    params.acme = PVE.Parser.printACME(acmeObj);
                }

                return params;
            },
            items: [
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'type',
                    fieldLabel: gettext('Challenge Type'),
                    allowBlank: false,
                    value: 'standalone',
                    comboItems: [
                        ['standalone', 'HTTP'],
                        ['dns', 'DNS'],
                    ],
                    validator: function (value) {
                        let me = this;
                        let win = me.up('pveACMEDomainEdit');
                        let oldconfigkey = win.domain ? win.domain.configkey : undefined;
                        let val = me.getValue();
                        if (val === 'dns' && (!oldconfigkey || oldconfigkey === 'acme')) {
                            // we have to check if there is a 'acmedomain' slot left
                            let found = false;
                            for (let i = 0; i < PVE.Utils.acmedomain_count; i++) {
                                if (!win.nodeconfig[`acmedomain${i}`]) {
                                    found = true;
                                }
                            }
                            if (!found) {
                                return gettext('Only 5 Domains with type DNS can be configured');
                            }
                        }

                        return true;
                    },
                    listeners: {
                        change: function (cb, value) {
                            let me = this;
                            let view = me.up('pveACMEDomainEdit');
                            let pluginField = view.down('field[name=plugin]');
                            pluginField.setDisabled(value !== 'dns');
                            pluginField.setHidden(value !== 'dns');
                        },
                    },
                },
                {
                    xtype: 'hidden',
                    name: 'alias',
                },
                {
                    xtype: 'pveACMEPluginSelector',
                    name: 'plugin',
                    disabled: true,
                    hidden: true,
                    allowBlank: false,
                },
                {
                    xtype: 'proxmoxtextfield',
                    name: 'domain',
                    allowBlank: false,
                    vtype: 'DnsName',
                    value: '',
                    fieldLabel: gettext('Domain'),
                },
            ],
        },
    ],

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no nodename given';
        }

        if (!me.nodeconfig) {
            throw 'no nodeconfig given';
        }

        me.isCreate = !me.domain;
        if (me.isCreate) {
            me.domain = `${me.nodename}.`; // TODO: FQDN of node
        }

        me.url = `/api2/extjs/nodes/${me.nodename}/config`;

        me.callParent();

        if (!me.isCreate) {
            me.setValues(me.domain);
        } else {
            me.setValues({ domain: me.domain });
        }
    },
});

Ext.define('pve-acme-domains', {
    extend: 'Ext.data.Model',
    fields: ['domain', 'type', 'alias', 'plugin', 'configkey'],
    idProperty: 'domain',
});

Ext.define('PVE.node.ACME', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.pveACMEView',

    margin: '10 0 0 0',
    title: 'ACME',

    emptyText: gettext('No Domains configured'),

    viewModel: {
        data: {
            domaincount: 0,
            account: undefined, // the account we display
            configaccount: undefined, // the account set in the config
            accountEditable: false,
            accountsAvailable: false,
        },

        formulas: {
            canOrder: (get) => !!get('account') && get('domaincount') > 0,
            editBtnIcon: (get) => 'fa black fa-' + (get('accountEditable') ? 'check' : 'pencil'),
            editBtnText: (get) => (get('accountEditable') ? gettext('Apply') : gettext('Edit')),
            accountTextHidden: (get) => get('accountEditable') || !get('accountsAvailable'),
            accountValueHidden: (get) => !get('accountEditable') || !get('accountsAvailable'),
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        init: function (view) {
            let accountSelector = this.lookup('accountselector');
            accountSelector.store.on('load', this.onAccountsLoad, this);
        },

        onAccountsLoad: function (store, records, success) {
            let me = this;
            let vm = me.getViewModel();
            let configaccount = vm.get('configaccount');
            vm.set('accountsAvailable', records.length > 0);
            if (me.autoChangeAccount && records.length > 0) {
                me.changeAccount(records[0].data.name, () => {
                    vm.set('accountEditable', false);
                    me.reload();
                });
                me.autoChangeAccount = false;
            } else if (configaccount) {
                if (store.findExact('name', configaccount) !== -1) {
                    vm.set('account', configaccount);
                } else {
                    vm.set('account', null);
                }
            }
        },

        addDomain: function () {
            let me = this;
            let view = me.getView();

            Ext.create('PVE.node.ACMEDomainEdit', {
                nodename: view.nodename,
                nodeconfig: view.nodeconfig,
                apiCallDone: function () {
                    me.reload();
                },
            }).show();
        },

        editDomain: function () {
            let me = this;
            let view = me.getView();

            let selection = view.getSelection();
            if (selection.length < 1) {
                return;
            }

            Ext.create('PVE.node.ACMEDomainEdit', {
                nodename: view.nodename,
                nodeconfig: view.nodeconfig,
                domain: selection[0].data,
                apiCallDone: function () {
                    me.reload();
                },
            }).show();
        },

        removeDomain: function () {
            let me = this;
            let view = me.getView();
            let selection = view.getSelection();
            if (selection.length < 1) {
                return;
            }

            let rec = selection[0].data;
            let params = {};
            if (rec.configkey !== 'acme') {
                params.delete = rec.configkey;
            } else {
                let acme = PVE.Parser.parseACME(view.nodeconfig.acme);
                PVE.Utils.remove_domain_from_acme(acme, rec.domain);
                params.acme = PVE.Parser.printACME(acme);
            }

            Proxmox.Utils.API2Request({
                method: 'PUT',
                url: `/nodes/${view.nodename}/config`,
                params,
                success: function (response, opt) {
                    me.reload();
                },
                failure: function (response, opt) {
                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                },
            });
        },

        toggleEditAccount: function () {
            let me = this;
            let vm = me.getViewModel();
            let editable = vm.get('accountEditable');
            if (editable) {
                me.changeAccount(vm.get('account'), function () {
                    vm.set('accountEditable', false);
                    me.reload();
                });
            } else {
                vm.set('accountEditable', true);
            }
        },

        changeAccount: function (account, callback) {
            let me = this;
            let view = me.getView();
            let params = {};

            let acme = PVE.Parser.parseACME(view.nodeconfig.acme);
            acme.account = account;
            params.acme = PVE.Parser.printACME(acme);

            Proxmox.Utils.API2Request({
                method: 'PUT',
                waitMsgTarget: view,
                url: `/nodes/${view.nodename}/config`,
                params,
                success: function (response, opt) {
                    if (Ext.isFunction(callback)) {
                        callback();
                    }
                },
                failure: function (response, opt) {
                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                },
            });
        },

        order: function () {
            let me = this;
            let view = me.getView();

            Proxmox.Utils.API2Request({
                method: 'POST',
                params: {
                    force: 1,
                },
                url: `/nodes/${view.nodename}/certificates/acme/certificate`,
                success: function (response, opt) {
                    Ext.create('Proxmox.window.TaskViewer', {
                        upid: response.result.data,
                        taskDone: function (success) {
                            me.orderFinished(success);
                        },
                    }).show();
                },
                failure: function (response, opt) {
                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                },
            });
        },

        orderFinished: function (success) {
            if (!success) {
                return;
            }
            // reload only if the Web UI is open on the same node that the cert was ordered for
            if (this.getView().nodename !== Proxmox.NodeName) {
                return;
            }
            var txt = gettext(
                'pveproxy will be restarted with new certificates, please reload the GUI!',
            );
            Ext.getBody().mask(txt, ['pve-static-mask']);
            // reload after 10 seconds automatically
            Ext.defer(function () {
                window.location.reload(true);
            }, 10000);
        },

        reload: function () {
            let me = this;
            let view = me.getView();
            view.rstore.load();
        },

        addAccount: function () {
            let me = this;
            Ext.create('PVE.node.ACMEAccountCreate', {
                autoShow: true,
                taskDone: function () {
                    me.reload();
                    let accountSelector = me.lookup('accountselector');
                    me.autoChangeAccount = true;
                    accountSelector.store.load();
                },
            });
        },
    },

    tbar: [
        {
            xtype: 'proxmoxButton',
            text: gettext('Add'),
            handler: 'addDomain',
            selModel: false,
        },
        {
            xtype: 'proxmoxButton',
            text: gettext('Edit'),
            disabled: true,
            handler: 'editDomain',
        },
        {
            xtype: 'proxmoxStdRemoveButton',
            handler: 'removeDomain',
        },
        '-',
        {
            xtype: 'button',
            reference: 'order',
            text: gettext('Order Certificates Now'),
            bind: {
                disabled: '{!canOrder}',
            },
            handler: 'order',
        },
        '-',
        {
            xtype: 'displayfield',
            value: gettext('Using Account') + ':',
            bind: {
                hidden: '{!accountsAvailable}',
            },
        },
        {
            xtype: 'displayfield',
            reference: 'accounttext',
            renderer: (val) => val || Proxmox.Utils.NoneText,
            bind: {
                value: '{account}',
                hidden: '{accountTextHidden}',
            },
        },
        {
            xtype: 'pveACMEAccountSelector',
            hidden: true,
            reference: 'accountselector',
            bind: {
                value: '{account}',
                hidden: '{accountValueHidden}',
            },
        },
        {
            xtype: 'button',
            iconCls: 'fa black fa-pencil',
            bind: {
                iconCls: '{editBtnIcon}',
                text: '{editBtnText}',
                hidden: '{!accountsAvailable}',
            },
            handler: 'toggleEditAccount',
        },
        {
            xtype: 'displayfield',
            value: gettext('No Account available.'),
            bind: {
                hidden: '{accountsAvailable}',
            },
        },
        {
            xtype: 'button',
            hidden: true,
            reference: 'accountlink',
            text: gettext('Add ACME Account'),
            bind: {
                hidden: '{accountsAvailable}',
            },
            handler: 'addAccount',
        },
    ],

    updateStore: function (store, records, success) {
        let me = this;
        let data = [];
        let rec;
        if (success && records.length > 0) {
            rec = records[0];
        } else {
            rec = {
                data: {},
            };
        }

        me.nodeconfig = rec.data; // save nodeconfig for updates

        let account = 'default';

        if (rec.data.acme) {
            let obj = PVE.Parser.parseACME(rec.data.acme);
            (obj.domains || []).forEach((domain) => {
                if (domain === '') {
                    return;
                }
                let record = {
                    domain,
                    type: 'standalone',
                    configkey: 'acme',
                };
                data.push(record);
            });

            if (obj.account) {
                account = obj.account;
            }
        }

        let vm = me.getViewModel();
        let oldaccount = vm.get('account');

        // account changed, and we do not edit currently, load again to verify
        if (oldaccount !== account && !vm.get('accountEditable')) {
            vm.set('configaccount', account);
            me.lookup('accountselector').store.load();
        }

        for (let i = 0; i < PVE.Utils.acmedomain_count; i++) {
            let acmedomain = rec.data[`acmedomain${i}`];
            if (!acmedomain) {
                continue;
            }

            let record = PVE.Parser.parsePropertyString(acmedomain, 'domain');
            record.type = 'dns';
            record.configkey = `acmedomain${i}`;
            data.push(record);
        }

        vm.set('domaincount', data.length);
        me.store.loadData(data, false);
    },

    listeners: {
        itemdblclick: 'editDomain',
    },

    columns: [
        {
            dataIndex: 'domain',
            flex: 5,
            text: gettext('Domain'),
        },
        {
            dataIndex: 'type',
            flex: 1,
            text: gettext('Type'),
        },
        {
            dataIndex: 'plugin',
            flex: 1,
            text: gettext('Plugin'),
        },
    ],

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no nodename given';
        }

        me.rstore = Ext.create('Proxmox.data.UpdateStore', {
            interval: 10 * 1000,
            autoStart: true,
            storeid: `pve-node-domains-${me.nodename}`,
            proxy: {
                type: 'proxmox',
                url: `/api2/json/nodes/${me.nodename}/config`,
            },
        });

        me.store = Ext.create('Ext.data.Store', {
            model: 'pve-acme-domains',
            sorters: 'domain',
        });

        me.callParent();
        me.mon(me.rstore, 'load', 'updateStore', me);
        Proxmox.Utils.monStoreErrors(me, me.rstore);
        me.on('destroy', me.rstore.stopUpdate, me.rstore);
    },
});
