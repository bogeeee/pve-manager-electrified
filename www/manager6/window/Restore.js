Ext.define('PVE.window.Restore', {
    extend: 'Ext.window.Window', // fixme: Proxmox.window.Edit?

    resizable: false,
    width: 500,
    modal: true,
    layout: 'auto',
    border: false,

    controller: {
        xclass: 'Ext.app.ViewController',
        control: {
            '#liveRestore': {
                change: function (el, newVal) {
                    let liveWarning = this.lookupReference('liveWarning');
                    liveWarning.setHidden(!newVal);
                    let start = this.lookupReference('start');
                    start.setDisabled(newVal);
                },
            },
            form: {
                validitychange: function (f, valid) {
                    this.lookupReference('doRestoreBtn').setDisabled(!valid);
                },
            },
        },

        doRestore: function () {
            let me = this;
            let view = me.getView();

            let values = view.down('form').getForm().getValues();

            let params = {
                vmid: view.vmid || values.vmid,
                force: view.vmid ? 1 : 0,
            };
            if (values.unique) {
                params.unique = 1;
            }
            if (values.start && !values['live-restore']) {
                params.start = 1;
            }
            if (values['ha-managed']) {
                params['ha-managed'] = 1;
            }
            if (values['live-restore']) {
                params['live-restore'] = 1;
            }
            if (values.storage) {
                params.storage = values.storage;
            }

            ['bwlimit', 'cores', 'name', 'memory', 'sockets'].forEach((opt) => {
                if ((values[opt] ?? '') !== '') {
                    params[opt] = values[opt];
                }
            });

            if (params.name && view.vmtype === 'lxc') {
                params.hostname = params.name;
                delete params.name;
            }

            let taskDescription;
            if (view.vmtype === 'lxc') {
                params.ostemplate = view.volid;
                params.restore = 1;
                if (values.unprivileged !== 'keep') {
                    params.unprivileged = values.unprivileged;
                }
                taskDescription = Proxmox.Utils.format_task_description('vzrestore', params.vmid);
            } else if (view.vmtype === 'qemu') {
                params.archive = view.volid;
                taskDescription = Proxmox.Utils.format_task_description('qmrestore', params.vmid);
            } else {
                throw 'unknown VM type';
            }
            let confirmMsg = Ext.htmlEncode(taskDescription);

            let executeRestore = () => {
                Proxmox.Utils.API2Request({
                    url: `/nodes/${view.nodename}/${view.vmtype}`,
                    params: params,
                    method: 'POST',
                    waitMsgTarget: view,
                    failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                    success: function (response, options) {
                        Ext.create('Proxmox.window.TaskViewer', {
                            autoShow: true,
                            upid: response.result.data,
                        });
                        view.close();
                    },
                });
            };

            if (view.vmid) {
                confirmMsg += `. ${Ext.String.format(
                    gettext('This will permanently erase current {0} data.'),
                    view.vmtype === 'lxc' ? 'CT' : 'VM',
                )}`;
                if (view.vmtype === 'lxc') {
                    confirmMsg += `<br>${gettext('Mount point volumes are also erased.')}`;
                }
                Ext.Msg.confirm(gettext('Confirm'), confirmMsg, function (btn) {
                    if (btn === 'yes') {
                        executeRestore();
                    }
                });
            } else {
                executeRestore();
            }
        },

        afterRender: function () {
            let view = this.getView();

            Proxmox.Utils.API2Request({
                url: `/nodes/${view.nodename}/vzdump/extractconfig`,
                method: 'GET',
                waitMsgTarget: view,
                params: {
                    volume: view.volid,
                },
                failure: (response) => Ext.Msg.alert('Error', response.htmlStatus),
                success: function (response, options) {
                    let allStoragesAvailable = true;

                    response.result.data.split('\n').forEach((line) => {
                        let [_, key, value] = line.match(/^([^:]+):\s*(\S+)\s*$/) ?? [];

                        if (!key) {
                            return;
                        }

                        if (key === '#qmdump#map') {
                            let match = value.match(/^(\S+):(\S+):(\S*):(\S*):$/) ?? [];
                            // if a /dev/XYZ disk was backed up, there is no storage hint
                            allStoragesAvailable &&=
                                !!match[3] &&
                                !!PVE.data.ResourceStore.getById(
                                    `storage/${view.nodename}/${match[3]}`,
                                );
                        } else if (key === 'name' || key === 'hostname') {
                            view.lookupReference('nameField').setEmptyText(value);
                        } else if (key === 'memory' || key === 'cores' || key === 'sockets') {
                            view.lookupReference(`${key}Field`).setEmptyText(value);
                        }
                    });

                    if (!allStoragesAvailable) {
                        let storagesel = view.down('pveStorageSelector[name=storage]');
                        storagesel.allowBlank = false;
                        storagesel.setEmptyText('');
                    }
                },
            });
        },
    },

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        if (!me.volid) {
            throw 'no volume ID specified';
        }
        if (!me.vmtype) {
            throw 'no vmtype specified';
        }

        let storagesel = Ext.create('PVE.form.StorageSelector', {
            nodename: me.nodename,
            name: 'storage',
            value: '',
            fieldLabel: gettext('Storage'),
            storageContent: me.vmtype === 'lxc' ? 'rootdir' : 'images',
            // when restoring a container without specifying a storage, the backend defaults
            // to 'local', which is unintuitive and 'rootdir' might not even be allowed on it
            allowBlank: me.vmtype !== 'lxc',
            emptyText: me.vmtype === 'lxc' ? '' : gettext('From backup configuration'),
            autoSelect: me.vmtype === 'lxc',
        });

        let items = [
            {
                xtype: 'displayfield',
                value: me.volidText || me.volid,
                fieldLabel: gettext('Source'),
            },
            storagesel,
            {
                xtype: 'pmxDisplayEditField',
                name: 'vmid',
                fieldLabel: me.vmtype === 'lxc' ? 'CT' : 'VM',
                value: me.vmid,
                editable: !me.vmid,
                editConfig: {
                    xtype: 'pveGuestIDSelector',
                    guestType: me.vmtype,
                    loadNextFreeID: true,
                    validateExists: false,
                },
            },
            {
                xtype: 'pveBandwidthField',
                name: 'bwlimit',
                backendUnit: 'KiB',
                allowZero: true,
                fieldLabel: gettext('Bandwidth Limit'),
                emptyText: gettext('Defaults to target storage restore limit'),
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext("Use '0' to disable all bandwidth limits."),
                },
            },
            {
                xtype: 'fieldcontainer',
                layout: 'hbox',
                items: [
                    {
                        xtype: 'proxmoxcheckbox',
                        name: 'unique',
                        fieldLabel: gettext('Unique'),
                        flex: 1,
                        autoEl: {
                            tag: 'div',
                            'data-qtip': gettext(
                                'Autogenerate unique properties, e.g., MAC addresses',
                            ),
                        },
                        checked: false,
                    },
                    {
                        xtype: 'proxmoxcheckbox',
                        name: 'start',
                        reference: 'start',
                        flex: 1,
                        fieldLabel: gettext('Start after restore'),
                        labelWidth: 105,
                        checked: false,
                    },
                    {
                        xtype: 'proxmoxcheckbox',
                        name: 'ha-managed',
                        reference: 'ha-managed',
                        flex: 1,
                        fieldLabel: gettext('Add to HA'),
                        labelWidth: 120,
                        checked: false,
                    },
                ],
            },
        ];

        if (me.vmtype === 'lxc') {
            items.push({
                xtype: 'radiogroup',
                fieldLabel: gettext('Privilege Level'),
                reference: 'noVNCScalingGroup',
                height: '15px', // renders faster with value assigned
                layout: {
                    type: 'hbox',
                    algin: 'stretch',
                },
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext(
                        'Choose if you want to keep or override the privilege level of the restored Container.',
                    ),
                },
                items: [
                    {
                        xtype: 'radiofield',
                        name: 'unprivileged',
                        inputValue: 'keep',
                        boxLabel: gettext('From Backup'),
                        flex: 1,
                        checked: true,
                    },
                    {
                        xtype: 'radiofield',
                        name: 'unprivileged',
                        inputValue: '1',
                        boxLabel: gettext('Unprivileged'),
                        flex: 1,
                    },
                    {
                        xtype: 'radiofield',
                        name: 'unprivileged',
                        inputValue: '0',
                        boxLabel: gettext('Privileged'),
                        flex: 1,
                        //margin: '0 0 0 10',
                    },
                ],
            });
        } else if (me.vmtype === 'qemu') {
            items.push(
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'live-restore',
                    itemId: 'liveRestore',
                    flex: 1,
                    fieldLabel: gettext('Live restore'),
                    checked: false,
                    hidden: !me.isPBS,
                },
                {
                    xtype: 'displayfield',
                    reference: 'liveWarning',
                    // TODO: Remove once more tested/stable?
                    value: gettext(
                        'Note: If anything goes wrong during the live-restore, new data written by the VM may be lost.',
                    ),
                    userCls: 'pmx-hint',
                    hidden: true,
                },
            );
        }

        items.push({
            xtype: 'fieldset',
            title: `${gettext('Override Settings')}:`,
            layout: 'hbox',
            defaults: {
                border: false,
                layout: 'anchor',
                flex: 1,
            },
            items: [
                {
                    padding: '0 10 0 0',
                    items: [
                        {
                            xtype: 'textfield',
                            fieldLabel: me.vmtype === 'lxc' ? gettext('Hostname') : gettext('Name'),
                            name: 'name',
                            vtype: 'DnsName',
                            reference: 'nameField',
                            allowBlank: true,
                        },
                        {
                            xtype: 'proxmoxintegerfield',
                            fieldLabel: gettext('Cores'),
                            name: 'cores',
                            reference: 'coresField',
                            minValue: 1,
                            maxValue: 128,
                            allowBlank: true,
                        },
                    ],
                },
                {
                    padding: '0 0 0 10',
                    items: [
                        {
                            xtype: 'pveMemoryField',
                            fieldLabel: gettext('Memory'),
                            name: 'memory',
                            reference: 'memoryField',
                            value: '',
                            allowBlank: true,
                        },
                        {
                            xtype: 'proxmoxintegerfield',
                            fieldLabel: gettext('Sockets'),
                            name: 'sockets',
                            reference: 'socketsField',
                            minValue: 1,
                            maxValue: 4,
                            allowBlank: true,
                            hidden: me.vmtype !== 'qemu',
                            disabled: me.vmtype !== 'qemu',
                        },
                    ],
                },
            ],
        });

        let title = gettext('Restore') + ': ' + (me.vmtype === 'lxc' ? 'CT' : 'VM');
        if (me.vmid) {
            let formattedGuestIdentifier = PVE.Utils.getFormattedGuestIdentifier(
                me.vmid,
                me.vmname,
            );
            title = `${gettext('Overwrite')} ${title} ${formattedGuestIdentifier}`;
        }

        Ext.apply(me, {
            title: title,
            items: [
                {
                    xtype: 'form',
                    bodyPadding: 10,
                    border: false,
                    fieldDefaults: {
                        labelWidth: 100,
                        anchor: '100%',
                    },
                    items: items,
                },
            ],
            buttons: [
                {
                    text: gettext('Restore'),
                    reference: 'doRestoreBtn',
                    handler: 'doRestore',
                },
            ],
        });

        me.callParent();
    },
});
