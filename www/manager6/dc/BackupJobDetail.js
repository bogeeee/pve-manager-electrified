Ext.define('PVE.dc.BackupDiskTree', {
    extend: 'Ext.tree.Panel',
    alias: 'widget.pveBackupDiskTree',

    folderSort: true,
    rootVisible: false,

    store: {
        sorters: 'id',
        data: {},
    },

    tools: [
        {
            type: 'expand',
            tooltip: gettext('Expand All'),
            callback: (panel) => panel.expandAll(),
        },
        {
            type: 'collapse',
            tooltip: gettext('Collapse All'),
            callback: (panel) => panel.collapseAll(),
        },
    ],

    columns: [
        {
            xtype: 'treecolumn',
            text: gettext('Guest Image'),
            renderer: function (value, meta, record) {
                if (record.data.type) {
                    // guest level
                    let ret = value;
                    if (record.data.name) {
                        ret += ' (' + record.data.name + ')';
                    }
                    return ret;
                } else {
                    // extJS needs unique IDs but we only want to show the volumes key from "vmid:key"
                    return value.split(':')[1] + ' - ' + record.data.name;
                }
            },
            dataIndex: 'id',
            flex: 6,
        },
        {
            text: gettext('Type'),
            dataIndex: 'type',
            flex: 1,
        },
        {
            text: gettext('Backup Job'),
            renderer: PVE.Utils.render_backup_status,
            dataIndex: 'included',
            flex: 3,
        },
    ],

    reload: function () {
        let me = this;
        let sm = me.getSelectionModel();

        Proxmox.Utils.API2Request({
            url: `/cluster/backup/${me.jobid}/included_volumes`,
            waitMsgTarget: me,
            method: 'GET',
            failure: function (response, opts) {
                Proxmox.Utils.setErrorMask(me, response.htmlStatus);
            },
            success: function (response, opts) {
                sm.deselectAll();
                me.setRootNode(response.result.data);
                me.expandAll();
            },
        });
    },

    initComponent: function () {
        var me = this;

        if (!me.jobid) {
            throw 'no job id specified';
        }

        var sm = Ext.create('Ext.selection.TreeModel', {});

        Ext.apply(me, {
            selModel: sm,
            fields: [
                'id',
                'type',
                {
                    type: 'string',
                    name: 'iconCls',
                    calculate: function (data) {
                        var txt = 'fa x-fa-tree fa-';
                        if (data.leaf && !data.type) {
                            return txt + 'hdd-o';
                        } else if (data.type === 'qemu') {
                            return txt + 'desktop';
                        } else if (data.type === 'lxc') {
                            return txt + 'cube';
                        } else {
                            return txt + 'question-circle';
                        }
                    },
                },
            ],
            header: {
                items: [
                    {
                        xtype: 'textfield',
                        fieldLabel: gettext('Search'),
                        labelWidth: 50,
                        emptyText: 'Name, VMID, Type',
                        width: 200,
                        padding: '0 5 0 0',
                        enableKeyEvents: true,
                        listeners: {
                            buffer: 500,
                            keyup: function (field) {
                                let searchValue = field.getValue().toLowerCase();
                                me.store.clearFilter(true);
                                me.store.filterBy(function (record) {
                                    let data = {};
                                    if (record.data.depth === 0) {
                                        return true;
                                    } else if (record.data.depth === 1) {
                                        data = record.data;
                                    } else if (record.data.depth === 2) {
                                        data = record.parentNode.data;
                                    }

                                    for (const property of ['name', 'id', 'type']) {
                                        if (!data[property]) {
                                            continue;
                                        }
                                        let v = data[property].toString();
                                        if (v !== undefined) {
                                            v = v.toLowerCase();
                                            if (v.includes(searchValue)) {
                                                return true;
                                            }
                                        }
                                    }
                                    return false;
                                });
                            },
                        },
                    },
                ],
            },
        });

        me.callParent();

        me.reload();
    },
});

Ext.define('PVE.dc.BackupInfo', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveBackupInfo',

    viewModel: {
        data: {
            retentionType: 'none',
            hideRecipients: true,
        },
        formulas: {
            hasRetention: (get) => get('retentionType') !== 'none',
            retentionKeepAll: (get) => get('retentionType') === 'all',
        },
    },

    padding: '5 0 5 10',

    column1: [
        {
            xtype: 'displayfield',
            name: 'node',
            fieldLabel: gettext('Node'),
            renderer: (value) => value || `-- ${gettext('All')} --`,
        },
        {
            xtype: 'displayfield',
            name: 'storage',
            fieldLabel: gettext('Storage'),
        },
        {
            xtype: 'displayfield',
            name: 'schedule',
            fieldLabel: gettext('Schedule'),
        },
        {
            xtype: 'displayfield',
            name: 'next-run',
            fieldLabel: gettext('Next Run'),
            renderer: PVE.Utils.render_next_event,
        },
        {
            xtype: 'displayfield',
            name: 'selMode',
            fieldLabel: gettext('Selection mode'),
        },
    ],
    column2: [
        {
            xtype: 'displayfield',
            name: 'notification-mode',
            fieldLabel: gettext('Notification'),
            renderer: function (value) {
                value = value ?? 'auto';
                let record = this.up('pveBackupInfo')?.record;
                let mailto = record?.mailto;
                let mailnotification = record?.mailnotification ?? 'always';

                if ((value === 'auto' && mailto === undefined) || value === 'notification-system') {
                    return gettext('Use global notification settings');
                } else if (mailnotification === 'always') {
                    return gettext('Always send email');
                } else {
                    return gettext('Send email on failure');
                }
            },
        },
        {
            xtype: 'displayfield',
            name: 'mailto',
            fieldLabel: gettext('Recipients'),
            hidden: true,
            bind: {
                hidden: '{hideRecipients}',
            },
            renderer: function (value) {
                if (!value) {
                    return gettext('No recipients configured');
                }

                return value;
            },
        },
        {
            xtype: 'displayfield',
            name: 'compress',
            fieldLabel: gettext('Compression'),
        },
        {
            xtype: 'displayfield',
            name: 'mode',
            fieldLabel: gettext('Mode'),
            renderer: function (value) {
                const modeToDisplay = {
                    snapshot: gettext('Snapshot'),
                    stop: gettext('Stop'),
                    suspend: gettext('Suspend'),
                };
                return modeToDisplay[value] ?? gettext('Unknown');
            },
        },
        {
            xtype: 'displayfield',
            name: 'enabled',
            fieldLabel: gettext('Enabled'),
            renderer: (v) =>
                PVE.Parser.parseBoolean(v.toString()) ? gettext('Yes') : gettext('No'),
        },
        {
            xtype: 'displayfield',
            name: 'pool',
            fieldLabel: gettext('Pool to backup'),
        },
    ],

    columnB: [
        {
            xtype: 'displayfield',
            name: 'comment',
            fieldLabel: gettext('Comment'),
            renderer: Ext.String.htmlEncode,
        },
        {
            xtype: 'fieldset',
            title: gettext('Retention Configuration'),
            layout: 'hbox',
            collapsible: true,
            defaults: {
                border: false,
                layout: 'anchor',
                flex: 1,
            },
            bind: {
                hidden: '{!hasRetention}',
            },
            items: [
                {
                    padding: '0 10 0 0',
                    defaults: {
                        labelWidth: 110,
                    },
                    items: [
                        {
                            xtype: 'displayfield',
                            name: 'keep-all',
                            fieldLabel: gettext('Keep All'),
                            renderer: Proxmox.Utils.format_boolean,
                            bind: {
                                hidden: '{!retentionKeepAll}',
                            },
                        },
                    ].concat(
                        [
                            ['keep-last', gettext('Keep Last')],
                            ['keep-hourly', gettext('Keep Hourly')],
                        ].map((name) => ({
                            xtype: 'displayfield',
                            name: name[0],
                            fieldLabel: name[1],
                            bind: {
                                hidden: '{!hasRetention || retentionKeepAll}',
                            },
                        })),
                    ),
                },
                {
                    padding: '0 0 0 10',
                    defaults: {
                        labelWidth: 110,
                    },
                    items: [
                        ['keep-daily', gettext('Keep Daily')],
                        ['keep-weekly', gettext('Keep Weekly')],
                    ].map((name) => ({
                        xtype: 'displayfield',
                        name: name[0],
                        fieldLabel: name[1],
                        bind: {
                            hidden: '{!hasRetention || retentionKeepAll}',
                        },
                    })),
                },
                {
                    padding: '0 0 0 10',
                    defaults: {
                        labelWidth: 110,
                    },
                    items: [
                        ['keep-monthly', gettext('Keep Monthly')],
                        ['keep-yearly', gettext('Keep Yearly')],
                    ].map((name) => ({
                        xtype: 'displayfield',
                        name: name[0],
                        fieldLabel: name[1],
                        bind: {
                            hidden: '{!hasRetention || retentionKeepAll}',
                        },
                    })),
                },
            ],
        },
    ],

    setValues: function (values) {
        var me = this;
        let vm = me.getViewModel();

        Ext.iterate(values, function (fieldId, val) {
            let field = me.query('[isFormField][name=' + fieldId + ']')[0];
            if (field) {
                field.setValue(val);
            }
        });

        if (values['prune-backups']) {
            let keepValues;
            if (values['prune-backups']) {
                keepValues = values['prune-backups'];
            } else {
                keepValues = { 'keep-all': 1 };
            }

            vm.set('retentionType', keepValues['keep-all'] ? 'all' : 'other');

            // set values of all keep-X fields
            ['all', 'last', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'].forEach((time) => {
                let name = `keep-${time}`;
                me.query(`[isFormField][name=${name}]`)[0]?.setValue(keepValues[name]);
            });
        } else {
            vm.set('retentionType', 'none');
        }

        let notificationMode = values['notification-mode'] ?? 'auto';
        let mailto = values.mailto;

        let hideRecipients =
            (notificationMode === 'auto' && mailto === undefined) ||
            notificationMode === 'notification-system';
        vm.set('hideRecipients', hideRecipients);

        // selection Mode depends on the presence/absence of several keys
        let selModeField = me.query('[isFormField][name=selMode]')[0];
        let selMode = 'none';
        if (values.vmid) {
            selMode = gettext('Include selected VMs');
        }
        if (values.all) {
            selMode = gettext('All');
        }
        if (values.exclude) {
            selMode = gettext('Exclude selected VMs');
        }
        if (values.pool) {
            selMode = gettext('Pool based');
        }
        selModeField.setValue(selMode);

        if (!values.pool) {
            let poolField = me.query('[isFormField][name=pool]')[0];
            poolField.setVisible(0);
        }
    },

    initComponent: function () {
        var me = this;

        if (!me.record) {
            throw 'no data provided';
        }
        me.callParent();

        me.setValues(me.record);
    },
});

Ext.define('PVE.dc.BackedGuests', {
    extend: 'Ext.grid.GridPanel',
    alias: 'widget.pveBackedGuests',

    stateful: true,
    stateId: 'grid-dc-backed-guests',

    textfilter: '',

    columns: [
        {
            header: gettext('Type'),
            dataIndex: 'type',
            renderer: PVE.Utils.render_resource_type,
            flex: 1,
            sortable: true,
        },
        {
            header: 'VMID',
            dataIndex: 'vmid',
            flex: 1,
            sortable: true,
        },
        {
            header: gettext('Name'),
            dataIndex: 'name',
            flex: 2,
            sortable: true,
        },
    ],
    viewConfig: {
        stripeRows: true,
        trackOver: false,
    },

    initComponent: function () {
        let me = this;

        me.store.clearFilter(true);

        Ext.apply(me, {
            tbar: [
                '->',
                gettext('Search') + ':',
                ' ',
                {
                    xtype: 'textfield',
                    width: 200,
                    emptyText: 'Name, VMID, Type',
                    enableKeyEvents: true,
                    listeners: {
                        buffer: 500,
                        keyup: function (field) {
                            let searchValue = field.getValue().toLowerCase();
                            me.store.clearFilter(true);
                            me.store.filterBy(function (record) {
                                let data = record.data;
                                for (const property of ['name', 'vmid', 'type']) {
                                    if (data[property] === null) {
                                        continue;
                                    }
                                    let v = data[property].toString();
                                    if (v !== undefined) {
                                        if (v.toLowerCase().includes(searchValue)) {
                                            return true;
                                        }
                                    }
                                }
                                return false;
                            });
                        },
                    },
                },
            ],
        });
        me.callParent();
    },
});
