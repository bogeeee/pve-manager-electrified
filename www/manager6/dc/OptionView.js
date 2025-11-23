Ext.define('PVE.dc.OptionView', {
    extend: 'Proxmox.grid.ObjectGrid',
    alias: ['widget.pveDcOptionView'],

    onlineHelp: 'datacenter_configuration_file',

    monStoreErrors: true,
    userCls: 'proxmox-tags-full',

    add_inputpanel_row: function (name, text, opts) {
        var me = this;

        opts = opts || {};
        me.rows = me.rows || {};

        let canEdit = !Object.hasOwn(opts, 'caps') || opts.caps;
        me.rows[name] = {
            required: true,
            defaultValue: opts.defaultValue,
            header: text,
            renderer: opts.renderer,
            editor: canEdit
                ? {
                      xtype: 'proxmoxWindowEdit',
                      width: opts.width || 350,
                      subject: text,
                      onlineHelp: opts.onlineHelp,
                      fieldDefaults: {
                          labelWidth: opts.labelWidth || 100,
                      },
                      setValues: function (values) {
                          var edit_value = values[name];

                          if (opts.parseBeforeSet) {
                              edit_value = PVE.Parser.parsePropertyString(edit_value);
                          }

                          Ext.Array.each(this.query('inputpanel'), function (panel) {
                              panel.setValues(edit_value);
                          });
                      },
                      url: opts.url,
                      items: [
                          {
                              xtype: 'inputpanel',
                              onGetValues: function (values) {
                                  if (values === undefined || Object.keys(values).length === 0) {
                                      return { delete: name };
                                  }
                                  var ret_val = {};
                                  ret_val[name] = PVE.Parser.printPropertyString(values);
                                  return ret_val;
                              },
                              items: opts.items,
                          },
                      ],
                  }
                : undefined,
        };
    },

    render_bwlimits: function (value) {
        if (!value) {
            return gettext('None');
        }

        let parsed = PVE.Parser.parsePropertyString(value);
        return Object.entries(parsed)
            .map(([k, v]) => k + ': ' + Proxmox.Utils.format_size(v * 1024) + '/s')
            .join(',');
    },

    initComponent: function () {
        var me = this;

        me.add_combobox_row('keyboard', gettext('Keyboard Layout'), {
            renderer: PVE.Utils.render_kvm_language,
            comboItems: Object.entries(PVE.Utils.kvm_keymaps),
            defaultValue: '__default__',
            deleteEmpty: true,
        });
        me.add_text_row('http_proxy', gettext('HTTP proxy'), {
            renderer: Ext.htmlEncode,
            defaultValue: Proxmox.Utils.noneText,
            vtype: 'HttpProxy',
            deleteEmpty: true,
        });
        me.add_combobox_row('console', gettext('Console Viewer'), {
            renderer: PVE.Utils.render_console_viewer,
            comboItems: Object.entries(PVE.Utils.console_map),
            defaultValue: '__default__',
            deleteEmpty: true,
        });
        me.add_text_row('email_from', gettext('Email from address'), {
            deleteEmpty: true,
            vtype: 'proxmoxMail',
            defaultValue: 'root@$hostname',
        });
        me.add_text_row('mac_prefix', gettext('MAC address prefix'), {
            deleteEmpty: true,
            vtype: 'MacPrefix',
            defaultValue: 'BC:24:11',
        });
        me.add_inputpanel_row('migration', gettext('Migration Settings'), {
            renderer: PVE.Utils.render_as_property_string,
            labelWidth: 120,
            url: '/api2/extjs/cluster/options',
            defaultKey: 'type',
            items: [
                {
                    xtype: 'displayfield',
                    name: 'type',
                    fieldLabel: gettext('Type'),
                    value: 'secure',
                    submitValue: true,
                },
                {
                    xtype: 'proxmoxNetworkSelector',
                    name: 'network',
                    fieldLabel: gettext('Network'),
                    value: null,
                    emptyText: Proxmox.Utils.defaultText,
                    autoSelect: false,
                    skipEmptyText: true,
                    editable: true,
                    notFoundIsValid: true,
                    vtype: 'IP64CIDRAddress',
                    type: 'include_sdn',
                },
            ],
        });
        me.add_inputpanel_row('replication', gettext('Replication Settings'), {
            renderer: PVE.Utils.render_as_property_string,
            labelWidth: 120,
            url: '/api2/extjs/cluster/options',
            defaultKey: 'type',
            items: [
                {
                    xtype: 'displayfield',
                    name: 'type',
                    fieldLabel: gettext('Type'),
                    value: 'secure',
                    submitValue: true,
                },
                {
                    xtype: 'proxmoxNetworkSelector',
                    name: 'network',
                    fieldLabel: gettext('Network'),
                    value: null,
                    emptyText: Proxmox.Utils.defaultText,
                    autoSelect: false,
                    skipEmptyText: true,
                    editable: true,
                    notFoundIsValid: true,
                    vtype: 'IP64CIDRAddress',
                    type: 'include_sdn',
                },
            ],
        });
        me.add_inputpanel_row('ha', gettext('HA Settings'), {
            renderer: PVE.Utils.render_dc_ha_opts,
            labelWidth: 120,
            url: '/api2/extjs/cluster/options',
            onlineHelp: 'ha_manager_shutdown_policy',
            items: [
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'shutdown_policy',
                    fieldLabel: gettext('Shutdown Policy'),
                    deleteEmpty: false,
                    value: '__default__',
                    comboItems: [
                        ['__default__', Proxmox.Utils.defaultText + ' (conditional)'],
                        ['freeze', 'freeze'],
                        ['failover', 'failover'],
                        ['migrate', 'migrate'],
                        ['conditional', 'conditional'],
                    ],
                    defaultValue: '__default__',
                },
            ],
        });
        me.add_inputpanel_row('crs', gettext('Cluster Resource Scheduling'), {
            renderer: PVE.Utils.render_as_property_string,
            width: 450,
            labelWidth: 120,
            url: '/api2/extjs/cluster/options',
            onlineHelp: 'ha_manager_crs',
            items: [
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'ha',
                    fieldLabel: gettext('HA Scheduling'),
                    deleteEmpty: false,
                    value: '__default__',
                    comboItems: [
                        ['__default__', Proxmox.Utils.defaultText + ' (basic)'],
                        ['basic', 'Basic (Resource Count)'],
                        ['static', 'Static Load'],
                    ],
                    defaultValue: '__default__',
                },
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'ha-rebalance-on-start',
                    fieldLabel: gettext('Rebalance on Start'),
                    boxLabel: gettext(
                        'Use CRS to select the least loaded node when starting an HA service',
                    ),
                    value: 0,
                },
            ],
        });
        me.add_inputpanel_row('u2f', gettext('U2F Settings'), {
            renderer: (v) =>
                !v ? Proxmox.Utils.NoneText : Ext.htmlEncode(PVE.Parser.printPropertyString(v)),
            width: 450,
            url: '/api2/extjs/cluster/options',
            onlineHelp: 'pveum_configure_u2f',
            items: [
                {
                    xtype: 'textfield',
                    name: 'appid',
                    fieldLabel: gettext('U2F AppID URL'),
                    emptyText: gettext('Defaults to origin'),
                    value: '',
                    deleteEmpty: true,
                    skipEmptyText: true,
                    submitEmptyText: false,
                },
                {
                    xtype: 'textfield',
                    name: 'origin',
                    fieldLabel: gettext('U2F Origin'),
                    emptyText: gettext('Defaults to requesting host URI'),
                    value: '',
                    deleteEmpty: true,
                    skipEmptyText: true,
                    submitEmptyText: false,
                },
                {
                    xtype: 'box',
                    height: 25,
                    html:
                        `<span class='pmx-hint'>${gettext('Note:')}</span> ` +
                        gettext('U2F is deprecated, use WebAuthn'),
                },
                {
                    xtype: 'displayfield',
                    userCls: 'pmx-hint',
                    value: gettext('NOTE: Changing an AppID breaks existing U2F registrations!'),
                },
            ],
        });
        me.add_inputpanel_row('webauthn', gettext('WebAuthn Settings'), {
            renderer: (v) =>
                !v ? Proxmox.Utils.NoneText : Ext.htmlEncode(PVE.Parser.printPropertyString(v)),
            width: 450,
            url: '/api2/extjs/cluster/options',
            onlineHelp: 'pveum_configure_webauthn',
            items: [
                {
                    xtype: 'textfield',
                    fieldLabel: gettext('Name'),
                    name: 'rp', // NOTE: relying party consists of name and id, this is the name
                    allowBlank: false,
                },
                {
                    xtype: 'textfield',
                    fieldLabel: gettext('Origin'),
                    emptyText: Ext.String.format(
                        gettext('Domain Lockdown (e.g., {0})'),
                        document.location.origin,
                    ),
                    name: 'origin',
                    allowBlank: true,
                },
                {
                    xtype: 'textfield',
                    fieldLabel: 'ID',
                    name: 'id',
                    allowBlank: false,
                    listeners: {
                        dirtychange: (f, isDirty) =>
                            f
                                .up('panel')
                                .down('box[id=idChangeWarning]')
                                .setHidden(!f.originalValue || !isDirty),
                    },
                },
                {
                    xtype: 'container',
                    layout: 'hbox',
                    items: [
                        {
                            xtype: 'box',
                            flex: 1,
                        },
                        {
                            xtype: 'button',
                            text: gettext('Auto-fill'),
                            iconCls: 'fa fa-fw fa-pencil-square-o',
                            handler: function (button, ev) {
                                let panel = this.up('panel');
                                let fqdn = document.location.hostname;

                                panel.down('field[name=rp]').setValue(fqdn);

                                let idField = panel.down('field[name=id]');
                                let currentID = idField.getValue();
                                if (!currentID || currentID.length === 0) {
                                    idField.setValue(fqdn);
                                }
                            },
                        },
                    ],
                },
                {
                    xtype: 'box',
                    height: 25,
                    html:
                        `<span class='pmx-hint'>${gettext('Note:')}</span> ` +
                        gettext('WebAuthn requires using a trusted certificate.'),
                },
                {
                    xtype: 'box',
                    id: 'idChangeWarning',
                    hidden: true,
                    padding: '5 0 0 0',
                    html:
                        '<i class="fa fa-exclamation-triangle warning"></i> ' +
                        gettext('Changing the ID breaks existing WebAuthn TFA entries.'),
                },
            ],
        });
        me.add_inputpanel_row('bwlimit', gettext('Bandwidth Limits'), {
            renderer: me.render_bwlimits,
            width: 450,
            url: '/api2/extjs/cluster/options',
            parseBeforeSet: true,
            labelWidth: 120,
            items: [
                {
                    xtype: 'pveBandwidthField',
                    name: 'default',
                    fieldLabel: gettext('Default'),
                    emptyText: gettext('none'),
                    backendUnit: 'KiB',
                },
                {
                    xtype: 'pveBandwidthField',
                    name: 'restore',
                    fieldLabel: gettext('Backup Restore'),
                    emptyText: gettext('default'),
                    backendUnit: 'KiB',
                },
                {
                    xtype: 'pveBandwidthField',
                    name: 'migration',
                    fieldLabel: gettext('Migration'),
                    emptyText: gettext('default'),
                    backendUnit: 'KiB',
                },
                {
                    xtype: 'pveBandwidthField',
                    name: 'clone',
                    fieldLabel: gettext('Clone'),
                    emptyText: gettext('default'),
                    backendUnit: 'KiB',
                },
                {
                    xtype: 'pveBandwidthField',
                    name: 'move',
                    fieldLabel: gettext('Disk Move'),
                    emptyText: gettext('default'),
                    backendUnit: 'KiB',
                },
            ],
        });
        me.add_integer_row('max_workers', gettext('Maximal Workers/bulk-action'), {
            deleteEmpty: true,
            defaultValue: 4,
            minValue: 1,
            maxValue: 64, // arbitrary but generous limit as limits are good
        });
        me.add_inputpanel_row('next-id', gettext('Next Free VMID Range'), {
            renderer: PVE.Utils.render_as_property_string,
            url: '/api2/extjs/cluster/options',
            items: [
                {
                    xtype: 'proxmoxintegerfield',
                    name: 'lower',
                    fieldLabel: gettext('Lower'),
                    emptyText: '100',
                    minValue: 100,
                    maxValue: 1000 * 1000 * 1000 - 1,
                    submitValue: true,
                },
                {
                    xtype: 'proxmoxintegerfield',
                    name: 'upper',
                    fieldLabel: gettext('Upper'),
                    emptyText: '1.000.000',
                    minValue: 100,
                    maxValue: 1000 * 1000 * 1000 - 1,
                    submitValue: true,
                },
            ],
        });
        me.rows['tag-style'] = {
            required: true,
            renderer: (value) => {
                if (value === undefined) {
                    return gettext('No Overrides');
                }
                let colors = PVE.UIOptions.parseTagOverrides(value?.['color-map']);
                let shape = value.shape;
                let shapeText = PVE.UIOptions.tagTreeStyles[shape ?? '__default__'];
                let txt = Ext.String.format(gettext('Tree Shape: {0}'), shapeText);
                let orderText = PVE.UIOptions.tagOrderOptions[value.ordering ?? '__default__'];
                txt += `, ${Ext.String.format(gettext('Ordering: {0}'), orderText)}`;
                if (value['case-sensitive']) {
                    txt += `, ${gettext('Case-Sensitive')}`;
                }
                if (Object.keys(colors).length > 0) {
                    txt += `, ${gettext('Color Overrides')}: `;
                    for (const tag of Object.keys(colors)) {
                        txt += Proxmox.Utils.getTagElement(tag, colors);
                    }
                }
                return txt;
            },
            header: gettext('Tag Style Override'),
            editor: {
                xtype: 'proxmoxWindowEdit',
                width: 800,
                subject: gettext('Tag Color Override'),
                onlineHelp: 'gui_tags',
                fieldDefaults: {
                    labelWidth: 100,
                },
                url: '/api2/extjs/cluster/options',
                items: [
                    {
                        xtype: 'inputpanel',
                        setValues: function (values) {
                            if (values === undefined) {
                                return undefined;
                            }
                            values = values?.['tag-style'] ?? {};
                            values.shape = values.shape || '__default__';
                            values.colors = values['color-map'];
                            return Proxmox.panel.InputPanel.prototype.setValues.call(this, values);
                        },
                        onGetValues: function (values) {
                            let style = {};
                            if (values.colors) {
                                style['color-map'] = values.colors;
                            }
                            if (values.shape && values.shape !== '__default__') {
                                style.shape = values.shape;
                            }
                            if (values.ordering) {
                                style.ordering = values.ordering;
                            }
                            if (values['case-sensitive']) {
                                style['case-sensitive'] = 1;
                            }
                            let value = PVE.Parser.printPropertyString(style);
                            if (value === '') {
                                return {
                                    delete: 'tag-style',
                                };
                            }
                            return {
                                'tag-style': value,
                            };
                        },
                        items: [
                            {
                                name: 'shape',
                                xtype: 'proxmoxComboGrid',
                                fieldLabel: gettext('Tree Shape'),
                                valueField: 'value',
                                displayField: 'display',
                                allowBlank: false,
                                listConfig: {
                                    columns: [
                                        {
                                            header: gettext('Option'),
                                            dataIndex: 'display',
                                            flex: 1,
                                        },
                                        {
                                            header: gettext('Preview'),
                                            dataIndex: 'value',
                                            renderer: function (value) {
                                                let cls = value ?? '__default__';
                                                if (value === '__default__') {
                                                    cls = 'circle';
                                                }
                                                let tags = PVE.Utils.renderTags('preview');
                                                return `<div class="proxmox-tags-${cls}">${tags}</div>`;
                                            },
                                            flex: 1,
                                        },
                                    ],
                                },
                                store: {
                                    data: Object.entries(PVE.UIOptions.tagTreeStyles).map((v) => ({
                                        value: v[0],
                                        display: v[1],
                                    })),
                                },
                                deleteDefault: true,
                                defaultValue: '__default__',
                                deleteEmpty: true,
                            },
                            {
                                name: 'ordering',
                                xtype: 'proxmoxKVComboBox',
                                fieldLabel: gettext('Ordering'),
                                comboItems: Object.entries(PVE.UIOptions.tagOrderOptions),
                                defaultValue: '__default__',
                                value: '__default__',
                                deleteEmpty: true,
                            },
                            {
                                name: 'case-sensitive',
                                xtype: 'proxmoxcheckbox',
                                fieldLabel: gettext('Case-Sensitive'),
                                boxLabel: gettext('Applies to new edits'),
                                value: 0,
                            },
                            {
                                xtype: 'displayfield',
                                fieldLabel: gettext('Color Overrides'),
                            },
                            {
                                name: 'colors',
                                xtype: 'pveTagColorGrid',
                                deleteEmpty: true,
                                height: 300,
                            },
                        ],
                    },
                ],
            },
        };

        me.rows['user-tag-access'] = {
            required: true,
            renderer: (value) => {
                if (value === undefined) {
                    return Ext.String.format(gettext('Mode: {0}'), 'free');
                }
                let mode = value?.['user-allow'] ?? 'free';
                let list = value?.['user-allow-list']?.join(',') ?? '';
                let modeTxt = Ext.String.format(gettext('Mode: {0}'), mode);
                let overrides = PVE.UIOptions.tagOverrides;
                let tags = PVE.Utils.renderTags(list, overrides);
                let listTxt = tags !== '' ? `, ${gettext('Pre-defined:')} ${tags}` : '';
                return `${modeTxt}${listTxt}`;
            },
            header: gettext('User Tag Access'),
            editor: {
                xtype: 'pveUserTagAccessEdit',
            },
        };

        me.rows['registered-tags'] = {
            required: true,
            renderer: (value) => {
                if (value === undefined) {
                    return gettext('No Registered Tags');
                }
                let overrides = PVE.UIOptions.tagOverrides;
                return PVE.Utils.renderTags(value.join(','), overrides);
            },
            header: gettext('Registered Tags'),
            editor: {
                xtype: 'pveRegisteredTagEdit',
            },
        };

        me.add_textareafield_row('consent-text', gettext('Consent Text'), {
            deleteEmpty: true,
            fieldOpts: {
                maxLength: 64 * 1024,
            },
            onlineHelp: 'gui_consent_banner',
        });

        me.selModel = Ext.create('Ext.selection.RowModel', {});

        Ext.apply(me, {
            tbar: [
                {
                    text: gettext('Edit'),
                    xtype: 'proxmoxButton',
                    disabled: true,
                    handler: function () {
                        me.run_editor();
                    },
                    selModel: me.selModel,
                },
            ],
            url: '/api2/json/cluster/options',
            editorConfig: {
                url: '/api2/extjs/cluster/options',
            },
            interval: 5000,
            cwidth1: 200,
            listeners: {
                itemdblclick: me.run_editor,
            },
        });

        me.callParent();

        // set the new value for the default console
        me.mon(me.rstore, 'load', function (store, records, success) {
            if (!success) {
                return;
            }

            var rec = store.getById('console');
            PVE.UIOptions.options.console = rec.data.value;
            if (rec.data.value === '__default__') {
                delete PVE.UIOptions.options.console;
            }

            PVE.UIOptions.options['tag-style'] = store.getById('tag-style')?.data?.value;
            PVE.UIOptions.updateTagSettings(PVE.UIOptions.options['tag-style']);
            PVE.UIOptions.fireUIConfigChanged();
        });

        me.on('activate', me.rstore.startUpdate);
        me.on('destroy', me.rstore.stopUpdate);
        me.on('deactivate', me.rstore.stopUpdate);
    },
});
