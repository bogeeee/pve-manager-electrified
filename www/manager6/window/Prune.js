Ext.define('pve-prune-list', {
    extend: 'Ext.data.Model',
    fields: [
        'type',
        'vmid',
        {
            name: 'ctime',
            type: 'date',
            dateFormat: 'timestamp',
        },
    ],
});

Ext.define('PVE.PruneInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pvePruneInputPanel',
    mixins: ['Proxmox.Mixin.CBind'],

    onGetValues: function (values) {
        let me = this;

        // the API expects a single prune-backups property string
        let pruneBackups = PVE.Parser.printPropertyString(values);
        values = {
            'prune-backups': pruneBackups,
            type: me.backup_type,
            vmid: me.backup_id,
        };

        return values;
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        init: function (view) {
            if (!view.url) {
                throw 'no url specified';
            }
            if (!view.backup_type) {
                throw 'no backup_type specified';
            }
            if (!view.backup_id) {
                throw 'no backup_id specified';
            }

            this.reload(); // initial load
        },

        reload: function () {
            let view = this.getView();

            // helper to allow showing why a backup is kept
            let addKeepReasons = function (backups, params) {
                const rules = [
                    'keep-last',
                    'keep-hourly',
                    'keep-daily',
                    'keep-weekly',
                    'keep-monthly',
                    'keep-yearly',
                    'keep-all', // when all keep options are not set
                ];
                let counter = {};

                backups.sort((a, b) => b.ctime - a.ctime);

                let ruleIndex = -1;
                let nextRule = function () {
                    let rule;
                    do {
                        ruleIndex++;
                        rule = rules[ruleIndex];
                    } while (!params[rule] && rule !== 'keep-all');
                    counter[rule] = 0;
                    return rule;
                };

                let rule = nextRule();
                for (let backup of backups) {
                    if (backup.mark === 'keep') {
                        counter[rule]++;
                        if (rule !== 'keep-all') {
                            backup.keepReason = rule + ': ' + counter[rule];
                            if (counter[rule] >= params[rule]) {
                                rule = nextRule();
                            }
                        } else {
                            backup.keepReason = rule;
                        }
                    }
                }
            };

            let params = view.getValues();
            let keepParams = PVE.Parser.parsePropertyString(params['prune-backups']);

            Proxmox.Utils.API2Request({
                url: view.url,
                method: 'GET',
                params: params,
                callback: function () {
                    // for easy breakpoint setting
                },
                failure: function (response, opts) {
                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                },
                success: function (response, options) {
                    var data = response.result.data;
                    addKeepReasons(data, keepParams);
                    view.pruneStore.setData(data);
                },
            });
        },

        control: {
            field: { change: 'reload' },
        },
    },

    column1: [
        {
            xtype: 'pmxPruneKeepField',
            name: 'keep-last',
            fieldLabel: gettext('keep-last'),
        },
        {
            xtype: 'pmxPruneKeepField',
            name: 'keep-hourly',
            fieldLabel: gettext('keep-hourly'),
        },
        {
            xtype: 'pmxPruneKeepField',
            name: 'keep-daily',
            fieldLabel: gettext('keep-daily'),
        },
        {
            xtype: 'pmxPruneKeepField',
            name: 'keep-weekly',
            fieldLabel: gettext('keep-weekly'),
        },
        {
            xtype: 'pmxPruneKeepField',
            name: 'keep-monthly',
            fieldLabel: gettext('keep-monthly'),
        },
        {
            xtype: 'pmxPruneKeepField',
            name: 'keep-yearly',
            fieldLabel: gettext('keep-yearly'),
        },
    ],

    initComponent: function () {
        var me = this;

        me.pruneStore = Ext.create('Ext.data.Store', {
            model: 'pve-prune-list',
            sorters: { property: 'ctime', direction: 'DESC' },
        });

        me.column2 = [
            {
                xtype: 'grid',
                height: 200,
                store: me.pruneStore,
                columns: [
                    {
                        header: gettext('Backup Time'),
                        sortable: true,
                        dataIndex: 'ctime',
                        renderer: function (value, metaData, record) {
                            let text = Ext.Date.format(value, 'Y-m-d H:i:s');
                            if (record.data.mark === 'remove') {
                                return (
                                    '<div style="text-decoration: line-through;">' + text + '</div>'
                                );
                            } else {
                                return text;
                            }
                        },
                        flex: 1,
                    },
                    {
                        text: 'Keep (reason)',
                        dataIndex: 'mark',
                        renderer: function (value, metaData, record) {
                            if (record.data.mark === 'keep') {
                                return 'true (' + record.data.keepReason + ')';
                            } else if (record.data.mark === 'protected') {
                                return 'true (protected)';
                            } else if (record.data.mark === 'renamed') {
                                return 'true (renamed)';
                            } else {
                                return 'false';
                            }
                        },
                        flex: 1,
                    },
                ],
            },
        ];

        me.callParent();
    },
});

Ext.define('PVE.window.Prune', {
    extend: 'Proxmox.window.Edit',

    method: 'DELETE',
    submitText: gettext('Prune'),

    fieldDefaults: { labelWidth: 130 },

    isCreate: true,

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no nodename specified';
        }
        if (!me.storage) {
            throw 'no storage specified';
        }
        if (!me.backup_type) {
            throw 'no backup_type specified';
        }
        if (me.backup_type !== 'qemu' && me.backup_type !== 'lxc') {
            throw 'unknown backup type: ' + me.backup_type;
        }
        if (!me.backup_id) {
            throw 'no backup_id specified';
        }

        let title = Ext.String.format(
            gettext("Prune Backups for '{0}' on Storage '{1}'"),
            me.backup_type + '/' + me.backup_id,
            me.storage,
        );

        Ext.apply(me, {
            url: '/api2/extjs/nodes/' + me.nodename + '/storage/' + me.storage + '/prunebackups',
            title: title,
            items: [
                {
                    xtype: 'pvePruneInputPanel',
                    url:
                        '/api2/extjs/nodes/' +
                        me.nodename +
                        '/storage/' +
                        me.storage +
                        '/prunebackups',
                    backup_type: me.backup_type,
                    backup_id: me.backup_id,
                    storage: me.storage,
                },
            ],
        });

        me.callParent();
    },
});
