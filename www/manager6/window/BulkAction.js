Ext.define('PVE.window.BulkAction', {
    extend: 'Ext.window.Window',

    resizable: true,
    width: 800,
    height: 600,
    modal: true,
    layout: {
        type: 'fit',
    },
    border: false,

    // the action to set, currently there are: `startall`, `migrateall`, `stopall`, `suspendall`
    action: undefined,

    // if set to true, the 'vms' parameter will be sent as an array'
    // necessary for the cluster-wide api call
    vmsAsArray: false,

    submit: function (params) {
        let me = this;

        let url;
        if (me.nodename) {
            url = `/nodes/${me.nodename}/${me.action}`;
        } else {
            url = `/cluster/bulk-action/guest/${me.action}`;
        }

        if (me.vmsAsArray) {
            params.vms = params.vms.split(/[,; ]/);
        }

        Proxmox.Utils.API2Request({
            params: params,
            url,
            waitMsgTarget: me,
            method: 'POST',
            failure: (response) => Ext.Msg.alert('Error', response.htmlStatus),
            success: function ({ result }, options) {
                Ext.create('Proxmox.window.TaskViewer', {
                    autoShow: true,
                    upid: result.data,
                    listeners: {
                        destroy: () => me.close(),
                    },
                });
                me.hide();
            },
        });
    },

    initComponent: function () {
        let me = this;

        if (!me.action) {
            throw 'no action specified';
        }
        if (!me.btnText) {
            throw 'no button text specified';
        }
        if (!me.title) {
            throw 'no title specified';
        }

        let items = [];
        if (me.action === 'migrateall' || me.action === 'migrate') {
            let disallowedNodes = [];
            if (me.nodename) {
                disallowedNodes.push(me.nodename);
            }
            items.push(
                {
                    xtype: 'fieldcontainer',
                    layout: 'hbox',
                    items: [
                        {
                            flex: 1,
                            xtype: 'pveNodeSelector',
                            name: 'target',
                            disallowedNodes,
                            fieldLabel: gettext('Target node'),
                            labelWidth: 200,
                            allowBlank: false,
                            onlineValidator: true,
                            padding: '0 10 0 0',
                        },
                        {
                            xtype: 'proxmoxintegerfield',
                            name: 'maxworkers',
                            minValue: 1,
                            maxValue: 100,
                            value: 1,
                            fieldLabel: gettext('Parallel jobs'),
                            allowBlank: false,
                            flex: 1,
                        },
                    ],
                },
                {
                    xtype: 'fieldcontainer',
                    layout: 'hbox',
                    items: [
                        {
                            xtype: 'proxmoxcheckbox',
                            fieldLabel: gettext('Allow local disk migration'),
                            name: 'with-local-disks',
                            labelWidth: 200,
                            checked: true,
                            uncheckedValue: 0,
                            flex: 1,
                            padding: '0 10 0 0',
                        },
                        {
                            itemId: 'lxcwarning',
                            xtype: 'displayfield',
                            userCls: 'pmx-hint',
                            value: 'Warning: Running CTs will be migrated in Restart Mode.',
                            hidden: true, // only visible if running container chosen
                            flex: 1,
                        },
                    ],
                },
            );
            if (me.action === 'migrate') {
                items.push({
                    xtype: 'hiddenfield',
                    name: 'online',
                    value: 1,
                });
            }
        } else if (me.action === 'startall') {
            items.push({
                xtype: 'hiddenfield',
                name: 'force',
                value: 1,
            });
        } else if (me.action === 'stopall' || me.action === 'shutdown') {
            items.push({
                xtype: 'fieldcontainer',
                layout: 'hbox',
                items: [
                    {
                        xtype: 'proxmoxcheckbox',
                        name: 'force-stop',
                        labelWidth: 120,
                        fieldLabel: gettext('Force Stop'),
                        boxLabel: gettext('Force stop guest if shutdown times out.'),
                        checked: true,
                        uncheckedValue: 0,
                        flex: 1,
                    },
                    {
                        xtype: 'proxmoxintegerfield',
                        name: 'timeout',
                        fieldLabel: gettext('Timeout (s)'),
                        labelWidth: 120,
                        emptyText: '180',
                        minValue: 0,
                        maxValue: 7200,
                        allowBlank: true,
                        flex: 1,
                    },
                ],
            });
        }

        let refreshLxcWarning = function (vmids, records) {
            let showWarning = records.some(
                (item) =>
                    vmids.includes(item.data.vmid) &&
                    item.data.type === 'lxc' &&
                    item.data.status === 'running',
            );
            me.down('#lxcwarning').setVisible(showWarning);
        };

        let defaulStatusMap = {
            migrateall: '',
            migrate: '',
            startall: 'stopped',
            start: 'stopped',
            stopall: 'running',
            shutdown: 'running',
            suspendall: 'running',
            suspend: 'running',
        };
        let defaultStatus = defaulStatusMap[me.action] ?? '';
        let defaultType = me.action === 'suspendall' ? 'qemu' : '';

        let statusMap = [];
        let poolMap = [];
        let haMap = [];
        let tagMap = [];
        PVE.data.ResourceStore.each((rec) => {
            if (['qemu', 'lxc'].indexOf(rec.data.type) !== -1) {
                statusMap[rec.data.status] = true;
            }
            if (rec.data.type === 'pool') {
                poolMap[rec.data.pool] = true;
            }
            if (rec.data.hastate !== '') {
                haMap[rec.data.hastate] = true;
            }
            if (rec.data.tags !== '') {
                rec.data.tags.split(/[,; ]/).forEach((tag) => {
                    if (tag !== '') {
                        tagMap[tag] = true;
                    }
                });
            }
        });

        let statusList = Object.keys(statusMap).map((key) => [key, key]);
        statusList.unshift(['', gettext('All')]);
        let poolList = Object.keys(poolMap).map((key) => [key, key]);
        let tagList = Object.keys(tagMap).map((key) => ({ value: key }));
        let haList = Object.keys(haMap).map((key) => [key, key]);

        let clearFilters = function () {
            me.down('#namefilter').setValue('');
            [
                'name',
                'status',
                'pool',
                'type',
                'hastate',
                'includetag',
                'excludetag',
                'vmid',
            ].forEach((filter) => {
                me.down(`#${filter}filter`).setValue('');
            });
        };

        let filterChange = function () {
            let nameValue = me.down('#namefilter').getValue();
            let filterCount = 0;

            if (nameValue !== '') {
                filterCount++;
            }

            let arrayFiltersData = [];
            ['pool', 'hastate'].forEach((filter) => {
                let selected = me.down(`#${filter}filter`).getValue() ?? [];
                if (selected.length) {
                    filterCount++;
                    arrayFiltersData.push([filter, [...selected]]);
                }
            });

            let singleFiltersData = [];
            ['status', 'type'].forEach((filter) => {
                let selected = me.down(`#${filter}filter`).getValue() ?? '';
                if (selected.length) {
                    filterCount++;
                    singleFiltersData.push([filter, selected]);
                }
            });

            let includeTags = me.down('#includetagfilter').getValue() ?? [];
            if (includeTags.length) {
                filterCount++;
            }
            let excludeTags = me.down('#excludetagfilter').getValue() ?? [];
            if (excludeTags.length) {
                filterCount++;
            }

            let fieldSet = me.down('#filters');
            let clearBtn = me.down('#clearBtn');
            if (filterCount) {
                fieldSet.setTitle(Ext.String.format(gettext('Filters ({0})'), filterCount));
                clearBtn.setDisabled(false);
            } else {
                fieldSet.setTitle(gettext('Filters'));
                clearBtn.setDisabled(true);
            }

            let filterFn = function (value) {
                let name = value.data.name.toLowerCase().indexOf(nameValue.toLowerCase()) !== -1;
                let arrayFilters = arrayFiltersData.every(
                    ([filter, selected]) =>
                        !selected.length || selected.indexOf(value.data[filter]) !== -1,
                );
                let singleFilters = singleFiltersData.every(
                    ([filter, selected]) =>
                        !selected.length || value.data[filter].indexOf(selected) !== -1,
                );
                let tags = value.data.tags.split(/[;, ]/).filter((t) => !!t);
                let includeFilter =
                    !includeTags.length || tags.some((tag) => includeTags.indexOf(tag) !== -1);
                let excludeFilter =
                    !excludeTags.length || tags.every((tag) => excludeTags.indexOf(tag) === -1);

                return name && arrayFilters && singleFilters && includeFilter && excludeFilter;
            };
            let vmselector = me.down('#vms');
            vmselector.getStore().setFilters({
                id: 'customFilter',
                filterFn,
            });
            vmselector.checkChange();
            if (me.action === 'migrateall') {
                let records = vmselector.getSelection();
                refreshLxcWarning(vmselector.getValue(), records);
            }
        };

        items.push({
            xtype: 'fieldset',
            itemId: 'filters',
            collapsible: true,
            title: gettext('Filters'),
            layout: 'hbox',
            items: [
                {
                    xtype: 'container',
                    flex: 1,
                    padding: 5,
                    layout: {
                        type: 'vbox',
                        align: 'stretch',
                    },
                    defaults: {
                        listeners: {
                            change: filterChange,
                        },
                        isFormField: false,
                    },
                    items: [
                        {
                            fieldLabel: gettext('Name'),
                            itemId: 'namefilter',
                            xtype: 'textfield',
                        },
                        {
                            xtype: 'combobox',
                            itemId: 'statusfilter',
                            fieldLabel: gettext('Status'),
                            emptyText: gettext('All'),
                            editable: false,
                            value: defaultStatus,
                            store: statusList,
                        },
                        {
                            xtype: 'combobox',
                            itemId: 'poolfilter',
                            fieldLabel: gettext('Pool'),
                            emptyText: gettext('All'),
                            editable: false,
                            multiSelect: true,
                            store: poolList,
                        },
                    ],
                },
                {
                    xtype: 'container',
                    layout: {
                        type: 'vbox',
                        align: 'stretch',
                    },
                    flex: 1,
                    padding: 5,
                    defaults: {
                        listeners: {
                            change: filterChange,
                        },
                        isFormField: false,
                    },
                    items: [
                        {
                            xtype: 'combobox',
                            itemId: 'typefilter',
                            fieldLabel: gettext('Type'),
                            emptyText: gettext('All'),
                            editable: false,
                            value: defaultType,
                            store: [
                                ['', gettext('All')],
                                ['lxc', gettext('CT')],
                                ['qemu', gettext('VM')],
                            ],
                        },
                        {
                            xtype: 'proxmoxComboGrid',
                            itemId: 'includetagfilter',
                            fieldLabel: gettext('Include Tags'),
                            emptyText: gettext('All'),
                            editable: false,
                            multiSelect: true,
                            valueField: 'value',
                            displayField: 'value',
                            listConfig: {
                                userCls: 'proxmox-tags-full',
                                columns: [
                                    {
                                        dataIndex: 'value',
                                        flex: 1,
                                        renderer: (value) =>
                                            PVE.Utils.renderTags(value, PVE.UIOptions.tagOverrides),
                                    },
                                ],
                            },
                            store: {
                                data: tagList,
                            },
                            listeners: {
                                change: filterChange,
                            },
                        },
                        {
                            xtype: 'proxmoxComboGrid',
                            itemId: 'excludetagfilter',
                            fieldLabel: gettext('Exclude Tags'),
                            emptyText: gettext('None'),
                            multiSelect: true,
                            editable: false,
                            valueField: 'value',
                            displayField: 'value',
                            listConfig: {
                                userCls: 'proxmox-tags-full',
                                columns: [
                                    {
                                        dataIndex: 'value',
                                        flex: 1,
                                        renderer: (value) =>
                                            PVE.Utils.renderTags(value, PVE.UIOptions.tagOverrides),
                                    },
                                ],
                            },
                            store: {
                                data: tagList,
                            },
                            listeners: {
                                change: filterChange,
                            },
                        },
                    ],
                },
                {
                    xtype: 'container',
                    layout: {
                        type: 'vbox',
                        align: 'stretch',
                    },
                    flex: 1,
                    padding: 5,
                    defaults: {
                        listeners: {
                            change: filterChange,
                        },
                        isFormField: false,
                    },
                    items: [
                        {
                            xtype: 'combobox',
                            itemId: 'hastatefilter',
                            fieldLabel: gettext('HA status'),
                            emptyText: gettext('All'),
                            multiSelect: true,
                            editable: false,
                            store: haList,
                            listeners: {
                                change: filterChange,
                            },
                        },
                        {
                            xtype: 'container',
                            layout: {
                                type: 'vbox',
                                align: 'end',
                            },
                            items: [
                                {
                                    xtype: 'button',
                                    itemId: 'clearBtn',
                                    text: gettext('Clear Filters'),
                                    disabled: true,
                                    handler: clearFilters,
                                },
                            ],
                        },
                    ],
                },
            ],
        });

        items.push({
            xtype: 'vmselector',
            itemId: 'vms',
            name: 'vms',
            flex: 1,
            height: 300,
            selectAll: true,
            allowBlank: false,
            plugins: '',
            nodename: me.nodename,
            listeners: {
                selectionchange: function (vmselector, records) {
                    if (me.action === 'migrateall') {
                        let vmids = me.down('#vms').getValue();
                        refreshLxcWarning(vmids, records);
                    }
                },
            },
        });

        me.formPanel = Ext.create('Ext.form.Panel', {
            bodyPadding: 10,
            border: false,
            layout: {
                type: 'vbox',
                align: 'stretch',
            },
            fieldDefaults: {
                anchor: '100%',
            },
            items: items,
        });

        let form = me.formPanel.getForm();

        let submitBtn = Ext.create('Ext.Button', {
            text: me.btnText,
            handler: function () {
                form.isValid();
                me.submit(form.getValues());
            },
        });

        Ext.apply(me, {
            items: [me.formPanel],
            buttons: [submitBtn],
        });

        me.callParent();

        if (me.prefilterIncludeTag) {
            me.down('#includetagfilter').setValue(me.prefilterIncludeTag);
        }

        form.on('validitychange', function () {
            let valid = form.isValid();
            submitBtn.setDisabled(!valid);
        });
        form.isValid();

        filterChange();
    },
});
