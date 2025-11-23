Ext.define('PVE.dc.RealmSyncJobView', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.pveRealmSyncJobView',

    stateful: true,
    stateId: 'grid-realmsyncjobs',

    emptyText: Ext.String.format(gettext('No {0} configured'), gettext('Realm Sync Job')),

    controller: {
        xclass: 'Ext.app.ViewController',

        addRealmSyncJob: function (button) {
            let me = this;
            Ext.create(`PVE.dc.RealmSyncJobEdit`, {
                autoShow: true,
                listeners: {
                    destroy: () => me.reload(),
                },
            });
        },

        editRealmSyncJob: function () {
            let me = this;
            let view = me.getView();
            let selection = view.getSelection();
            if (!selection || selection.length < 1) {
                return;
            }

            Ext.create(`PVE.dc.RealmSyncJobEdit`, {
                jobid: selection[0].data.id,
                autoShow: true,
                listeners: {
                    destroy: () => me.reload(),
                },
            });
        },

        runNow: function () {
            let me = this;
            let view = me.getView();
            let selection = view.getSelection();
            if (!selection || selection.length < 1) {
                return;
            }

            let params = selection[0].data;
            let realm = params.realm;

            let propertiesToDelete = [
                'comment',
                'realm',
                'id',
                'type',
                'schedule',
                'last-run',
                'next-run',
                'enabled',
            ];
            for (const prop of propertiesToDelete) {
                delete params[prop];
            }

            Proxmox.Utils.API2Request({
                url: `/access/domains/${realm}/sync`,
                params,
                waitMsgTarget: view,
                method: 'POST',
                failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                success: function (response, options) {
                    Ext.create('Proxmox.window.TaskProgress', {
                        autoShow: true,
                        upid: response.result.data,
                        taskDone: () => {
                            me.reload();
                        },
                    });
                },
            });
        },

        reload: function () {
            this.getView().getStore().load();
        },
    },

    store: {
        autoLoad: true,
        id: 'realm-syncs',
        proxy: {
            type: 'proxmox',
            url: '/api2/json/cluster/jobs/realm-sync',
        },
    },

    viewConfig: {
        getRowClass: (record, _index) => (record.get('enabled') ? '' : 'proxmox-disabled-row'),
    },

    columns: [
        {
            header: gettext('Enabled'),
            width: 80,
            dataIndex: 'enabled',
            sortable: true,
            align: 'center',
            stopSelection: false,
            renderer: Proxmox.Utils.renderEnabledIcon,
        },
        {
            text: gettext('Name'),
            flex: 1,
            dataIndex: 'id',
            hidden: true,
        },
        {
            text: gettext('Realm'),
            width: 200,
            dataIndex: 'realm',
        },
        {
            header: gettext('Schedule'),
            width: 150,
            dataIndex: 'schedule',
        },
        {
            text: gettext('Next Run'),
            dataIndex: 'next-run',
            width: 150,
            renderer: PVE.Utils.render_next_event,
        },
        {
            header: gettext('Comment'),
            dataIndex: 'comment',
            renderer: Ext.htmlEncode,
            sorter: (a, b) => (a.data.comment || '').localeCompare(b.data.comment || ''),
            flex: 1,
        },
    ],

    tbar: [
        {
            text: gettext('Add'),
            handler: 'addRealmSyncJob',
        },
        {
            text: gettext('Edit'),
            xtype: 'proxmoxButton',
            handler: 'editRealmSyncJob',
            disabled: true,
        },
        {
            xtype: 'proxmoxStdRemoveButton',
            baseurl: `/api2/extjs/cluster/jobs/realm-sync`,
            callback: 'reload',
        },
        {
            xtype: 'proxmoxButton',
            handler: 'runNow',
            disabled: true,
            text: gettext('Run Now'),
        },
    ],

    listeners: {
        itemdblclick: 'editRealmSyncJob',
    },

    initComponent: function () {
        var me = this;

        me.callParent();

        Proxmox.Utils.monStoreErrors(me, me.getStore());
    },
});

Ext.define('PVE.dc.RealmSyncJobEdit', {
    extend: 'Proxmox.window.Edit',
    mixins: ['Proxmox.Mixin.CBind'],

    subject: gettext('Realm Sync Job'),
    onlineHelp: 'pveum_ldap_sync',

    // don't focus the schedule field on edit
    defaultFocus: 'field[name=id]',

    cbindData: function () {
        let me = this;
        me.isCreate = !me.jobid;
        me.jobid = me.jobid || '';
        let url = '/api2/extjs/cluster/jobs/realm-sync';
        me.url = me.jobid ? `${url}/${me.jobid}` : url;
        me.method = me.isCreate ? 'POST' : 'PUT';
        if (!me.isCreate) {
            me.subject = `${me.subject}: ${me.jobid}`;
        }
        return {};
    },

    submitUrl: function (url, values) {
        return this.isCreate ? `${url}/${values.id}` : url;
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        updateDefaults: function (_field, newValue) {
            let me = this;

            ['scope', 'enable-new', 'schedule'].forEach((reference) => {
                me.lookup(reference)?.setDisabled(false);
            });

            // only update on create
            if (!me.getView().isCreate) {
                return;
            }
            Proxmox.Utils.API2Request({
                url: `/access/domains/${newValue}`,
                success: function (response) {
                    // first reset the fields to their default
                    ['acl', 'entry', 'properties'].forEach((opt) => {
                        me.lookup(`remove-vanished-${opt}`)?.setValue(false);
                    });
                    me.lookup('enable-new')?.setValue('1');
                    me.lookup('scope')?.setValue(undefined);

                    let options = response?.result?.data?.['sync-defaults-options'];
                    if (options) {
                        let parsed = PVE.Parser.parsePropertyString(options);
                        if (parsed['remove-vanished']) {
                            let opts = parsed['remove-vanished'].split(';');
                            for (const opt of opts) {
                                me.lookup(`remove-vanished-${opt}`)?.setValue(true);
                            }
                            delete parsed['remove-vanished'];
                        }
                        for (const [name, value] of Object.entries(parsed)) {
                            me.lookup(name)?.setValue(value);
                        }
                    }
                },
            });
        },
    },

    items: [
        {
            xtype: 'inputpanel',

            cbind: {
                isCreate: '{isCreate}',
            },

            onGetValues: function (values) {
                let me = this;

                let vanished_opts = [];
                ['acl', 'entry', 'properties'].forEach((prop) => {
                    if (values[`remove-vanished-${prop}`]) {
                        vanished_opts.push(prop);
                    }
                    delete values[`remove-vanished-${prop}`];
                });

                if (!values.id && me.isCreate) {
                    values.id =
                        'realmsync-' + Ext.data.identifier.Uuid.Global.generate().slice(0, 13);
                }

                if (vanished_opts.length > 0) {
                    values['remove-vanished'] = vanished_opts.join(';');
                } else {
                    values['remove-vanished'] = 'none';
                }

                PVE.Utils.delete_if_default(values, 'node', '');

                if (me.isCreate) {
                    delete values.delete; // on create we cannot delete values
                }

                return values;
            },

            column1: [
                {
                    xtype: 'pmxDisplayEditField',
                    editConfig: {
                        xtype: 'pmxRealmComboBox',
                        storeFilter: (rec) => rec.data.type === 'ldap' || rec.data.type === 'ad',
                    },
                    listConfig: {
                        emptyText: `<div class="x-grid-empty">${gettext('No LDAP/AD Realm found')}</div>`,
                    },
                    cbind: {
                        editable: '{isCreate}',
                    },
                    listeners: {
                        change: 'updateDefaults',
                    },
                    fieldLabel: gettext('Realm'),
                    name: 'realm',
                    reference: 'realm',
                },
                {
                    xtype: 'pveCalendarEvent',
                    fieldLabel: gettext('Schedule'),
                    disabled: true,
                    allowBlank: false,
                    name: 'schedule',
                    reference: 'schedule',
                },
                {
                    xtype: 'proxmoxcheckbox',
                    fieldLabel: gettext('Enable Job'),
                    name: 'enabled',
                    reference: 'enabled',
                    uncheckedValue: 0,
                    defaultValue: 1,
                    checked: true,
                },
            ],

            column2: [
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'scope',
                    reference: 'scope',
                    disabled: true,
                    fieldLabel: gettext('Scope'),
                    value: '',
                    emptyText: gettext('No default available'),
                    deleteEmpty: false,
                    allowBlank: false,
                    comboItems: [
                        ['users', gettext('Users')],
                        ['groups', gettext('Groups')],
                        ['both', gettext('Users and Groups')],
                    ],
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    value: '1',
                    deleteEmpty: false,
                    disabled: true,
                    allowBlank: false,
                    comboItems: [
                        ['1', Proxmox.Utils.yesText],
                        ['0', Proxmox.Utils.noText],
                    ],
                    name: 'enable-new',
                    reference: 'enable-new',
                    fieldLabel: gettext('Enable New'),
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
                            reference: 'remove-vanished-acl',
                            boxLabel: gettext('Remove ACLs of vanished users and groups.'),
                        },
                        {
                            xtype: 'proxmoxcheckbox',
                            fieldLabel: gettext('Entry'),
                            name: 'remove-vanished-entry',
                            reference: 'remove-vanished-entry',
                            boxLabel: gettext('Remove vanished user and group entries.'),
                        },
                        {
                            xtype: 'proxmoxcheckbox',
                            fieldLabel: gettext('Properties'),
                            name: 'remove-vanished-properties',
                            reference: 'remove-vanished-properties',
                            boxLabel: gettext('Remove vanished properties from synced users.'),
                        },
                    ],
                },
                {
                    xtype: 'proxmoxtextfield',
                    name: 'comment',
                    fieldLabel: gettext('Job Comment'),
                    cbind: {
                        deleteEmpty: '{!isCreate}',
                    },
                    autoEl: {
                        tag: 'div',
                        'data-qtip': gettext('Description of the job'),
                    },
                },
                {
                    xtype: 'displayfield',
                    reference: 'defaulthint',
                    value: gettext('Default sync options can be set by editing the realm.'),
                    userCls: 'pmx-hint',
                    hidden: true,
                },
            ],
        },
    ],

    initComponent: function () {
        let me = this;
        me.callParent();
        if (me.jobid) {
            me.load({
                success: function (response, options) {
                    let values = response.result.data;

                    if (values['remove-vanished']) {
                        let opts = values['remove-vanished'].split(';');
                        for (const opt of opts) {
                            values[`remove-vanished-${opt}`] = 1;
                        }
                    }
                    me.down('inputpanel').setValues(values);
                },
            });
        }
    },
});
