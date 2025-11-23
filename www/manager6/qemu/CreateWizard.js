Ext.define('PVE.qemu.CreateWizard', {
    extend: 'PVE.window.Wizard',
    alias: 'widget.pveQemuCreateWizard',
    mixins: ['Proxmox.Mixin.CBind'],

    viewModel: {
        data: {
            nodename: '',
            current: {
                scsihw: '',
            },
        },
        formulas: {
            cgroupMode: function (get) {
                const nodeInfo = PVE.data.ResourceStore.getNodes().find(
                    (node) => node.node === get('nodename'),
                );
                return nodeInfo ? nodeInfo['cgroup-mode'] : 2;
            },
        },
    },

    cbindData: {
        nodename: undefined,
    },

    subject: gettext('Virtual Machine'),

    // fot the special case that we have 2 cdrom drives
    //
    // emulates part of the backend bootorder logic, but includes all cdrom drives since the backend
    // cannot know which one is a bootable iso and hardcodes the known values (ide0/2, net0)
    calculateBootOrder: function (values) {
        // user selected windows + second cdrom
        if (values.ide0 && values.ide0.match(/media=cdrom/)) {
            let disk;
            PVE.Utils.forEachBus(['ide', 'scsi', 'virtio', 'sata'], (type, id) => {
                let confId = type + id;
                if (!values[confId]) {
                    return undefined;
                }
                if (values[confId].match(/media=cdrom/)) {
                    return undefined;
                }
                disk = confId;
                return false; // abort loop
            });

            let order = [];
            if (disk) {
                order.push(disk);
            }
            order.push('ide2', 'ide0'); // ide2 is the install ISO and should be first
            if (values.net0) {
                order.push('net0');
            }

            return `order=${order.join(';')}`;
        }
        return undefined;
    },

    items: [
        {
            xtype: 'inputpanel',
            title: gettext('General'),
            onlineHelp: 'qm_general_settings',
            column1: [
                {
                    xtype: 'pveNodeSelector',
                    name: 'nodename',
                    cbind: {
                        selectCurNode: '{!nodename}',
                        preferredValue: '{nodename}',
                    },
                    bind: {
                        value: '{nodename}',
                    },
                    fieldLabel: gettext('Node'),
                    allowBlank: false,
                    onlineValidator: true,
                },
                {
                    xtype: 'pveGuestIDSelector',
                    name: 'vmid',
                    guestType: 'qemu',
                    value: '',
                    loadNextFreeID: true,
                    validateExists: false,
                },
                {
                    xtype: 'textfield',
                    name: 'name',
                    vtype: 'DnsName',
                    value: '',
                    fieldLabel: gettext('Name'),
                    allowBlank: true,
                },
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'ha-managed',
                    // only submit value of checkbox if checked
                    uncheckedValue: undefined,
                    fieldLabel: gettext('Add to HA'),
                },
            ],
            column2: [
                {
                    xtype: 'pvePoolSelector',
                    fieldLabel: gettext('Resource Pool'),
                    name: 'pool',
                    value: '',
                    allowBlank: true,
                },
            ],
            advancedColumn1: [
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'onboot',
                    uncheckedValue: 0,
                    defaultValue: 0,
                    deleteDefaultValue: true,
                    fieldLabel: gettext('Start at boot'),
                },
            ],
            advancedColumn2: [
                {
                    xtype: 'textfield',
                    name: 'order',
                    defaultValue: '',
                    emptyText: 'any',
                    labelWidth: 120,
                    fieldLabel: gettext('Start/Shutdown order'),
                },
                {
                    xtype: 'textfield',
                    name: 'up',
                    defaultValue: '',
                    emptyText: 'default',
                    labelWidth: 120,
                    fieldLabel: gettext('Startup delay'),
                },
                {
                    xtype: 'textfield',
                    name: 'down',
                    defaultValue: '',
                    emptyText: 'default',
                    labelWidth: 120,
                    fieldLabel: gettext('Shutdown timeout'),
                },
            ],

            advancedColumnB: [
                {
                    xtype: 'pveTagFieldSet',
                    name: 'tags',
                    maxHeight: 150,
                },
            ],

            onGetValues: function (values) {
                ['name', 'pool', 'onboot', 'agent'].forEach(function (field) {
                    if (!values[field]) {
                        delete values[field];
                    }
                });

                var res = PVE.Parser.printStartup({
                    order: values.order,
                    up: values.up,
                    down: values.down,
                });

                if (res) {
                    values.startup = res;
                }

                delete values.order;
                delete values.up;
                delete values.down;

                return values;
            },
        },
        {
            xtype: 'container',
            layout: 'hbox',
            defaults: {
                flex: 1,
                padding: '0 10',
            },
            title: gettext('OS'),
            items: [
                {
                    xtype: 'pveQemuCDInputPanel',
                    bind: {
                        nodename: '{nodename}',
                    },
                    confid: 'ide2',
                    insideWizard: true,
                },
                {
                    xtype: 'pveQemuOSTypePanel',
                    insideWizard: true,
                    bind: {
                        nodename: '{nodename}',
                    },
                },
            ],
        },
        {
            xtype: 'pveQemuSystemPanel',
            title: gettext('System'),
            isCreate: true,
            insideWizard: true,
        },
        {
            xtype: 'pveMultiHDPanel',
            bind: {
                nodename: '{nodename}',
            },
            title: gettext('Disks'),
        },
        {
            xtype: 'pveQemuProcessorPanel',
            insideWizard: true,
            title: gettext('CPU'),
        },
        {
            xtype: 'pveQemuMemoryPanel',
            insideWizard: true,
            title: gettext('Memory'),
        },
        {
            xtype: 'pveQemuNetworkInputPanel',
            bind: {
                nodename: '{nodename}',
            },
            title: gettext('Network'),
            insideWizard: true,
        },
        {
            title: gettext('Confirm'),
            layout: 'fit',
            items: [
                {
                    xtype: 'grid',
                    store: {
                        model: 'KeyValue',
                        sorters: [
                            {
                                property: 'key',
                                direction: 'ASC',
                            },
                        ],
                    },
                    columns: [
                        { header: 'Key', width: 150, dataIndex: 'key' },
                        { header: 'Value', flex: 1, dataIndex: 'value', renderer: Ext.htmlEncode },
                    ],
                },
            ],
            dockedItems: [
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'start',
                    dock: 'bottom',
                    margin: '5 0 0 0',
                    boxLabel: gettext('Start after created'),
                },
            ],
            listeners: {
                show: function (panel) {
                    let wizard = this.up('window');
                    var kv = wizard.getValues();
                    var data = [];

                    let boot = wizard.calculateBootOrder(kv);
                    if (boot) {
                        kv.boot = boot;
                    }

                    Ext.Object.each(kv, function (key, value) {
                        if (key === 'delete') {
                            // ignore
                            return;
                        }
                        data.push({ key: key, value: value });
                    });

                    var summarystore = panel.down('grid').getStore();
                    summarystore.suspendEvents();
                    summarystore.removeAll();
                    summarystore.add(data);
                    summarystore.sort();
                    summarystore.resumeEvents();
                    summarystore.fireEvent('refresh');
                },
            },
            onSubmit: function () {
                var wizard = this.up('window');
                var kv = wizard.getValues();
                delete kv.delete;

                var nodename = kv.nodename;
                delete kv.nodename;

                let boot = wizard.calculateBootOrder(kv);
                if (boot) {
                    kv.boot = boot;
                }

                Proxmox.Utils.API2Request({
                    url: '/nodes/' + nodename + '/qemu',
                    waitMsgTarget: wizard,
                    method: 'POST',
                    params: kv,
                    success: function (response) {
                        wizard.close();
                    },
                    failure: function (response, opts) {
                        Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                    },
                });
            },
        },
    ],
});
